import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { parseGenres } from '../utils/music-format.js';
import {
  MUSIC_LANGUAGE_BATCH_SIZE,
  MUSIC_LANGUAGE_DETECTION_VERSION,
  resolveTrackLanguageEvidence,
  type TrackLanguageEvidence,
} from './music-language-evidence.js';

export interface MusicLanguageEnrichmentResult {
  processed: number;
  updated: number;
  known: number;
  unknown: number;
  batches: number;
  lyricsChecked: number;
  lyricsFetched: number;
  lyricsNotFound: number;
  lyricsFailed: number;
  providerLookups: number;
  providerHttp429: number;
  providerHttp5xx: number;
  languagesResolvedThisRun: number;
  version: number;
}

export interface BackgroundLyricsLookupService {
  lookupOnlineLyrics(input: {
    trackId: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    onProviderResponse?: (status: number) => void;
  }): Promise<
    { status: 'found'; languageResolved?: boolean } | { status: 'not_found' }
  >;
}

export const MUSIC_LYRICS_ENRICHMENT_BATCH_SIZE = 25;
export const MUSIC_LYRICS_ENRICHMENT_CONCURRENCY = 2;
const LYRICS_LOOKUP_LEASE_MS = 15 * 60 * 1000;
const LYRICS_NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

const activeJobs = new Map<string, Promise<MusicLanguageEnrichmentResult>>();
const activeJobStartedAt = new Map<string, string>();
const lastJobTimes = new Map<string, { startedAt: string; completedAt: string }>();
const lastJobs = new Map<
  string,
  MusicLanguageEnrichmentResult & { startedAt: string; completedAt: string }
>();

const nonManualLanguageWhere: Prisma.MusicTrackWhereInput = {
  OR: [{ languageSource: null }, { languageSource: { not: 'manual' } }],
};

const pendingLanguageWhere: Prisma.MusicTrackWhereInput = {
  AND: [
    nonManualLanguageWhere,
    {
      OR: [
        { languageDetectionVersion: null },
        { languageDetectionVersion: { lt: MUSIC_LANGUAGE_DETECTION_VERSION } },
      ],
    },
  ],
};

const trackSelect = {
  id: true,
  genres: true,
  languageCode: true,
  languageSource: true,
  languageConfidence: true,
  lyrics: { select: { language: true, content: true, sourceType: true } },
  album: { select: { genres: true } },
} satisfies Prisma.MusicTrackSelect;

export const selectDeterministicPilotIds = (ids: string[], maxTracks: number): string[] => {
  if (ids.length <= maxTracks) return [...ids];
  return Array.from({ length: maxTracks }, (_, index) => {
    const position = Math.floor(((index + 0.5) * ids.length) / maxTracks);
    return ids[Math.min(position, ids.length - 1)]!;
  });
};

export class MusicLanguageEnrichmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly lyricsLookup?: BackgroundLyricsLookupService,
  ) {}

  public enrichUser(
    userId: string,
    options: { batchSize?: number; maxBatches?: number } = {},
  ) {
    return this.runExclusive(`user:${userId}`, { library: { userId } }, options);
  }

  public startUser(userId: string, options: { maxTracks?: number } = {}) {
    const key = `user:${userId}`;
    if (activeJobs.has(key)) return { status: 'running' as const };
    const startedAt = new Date().toISOString();
    activeJobStartedAt.set(key, startedAt);
    const job = this.enrichUserWithLyrics(userId, options);
    activeJobs.set(key, job);
    void job
      .then((result) => {
        const completedAt = new Date().toISOString();
        lastJobs.set(key, { ...result, startedAt, completedAt });
        lastJobTimes.set(key, { startedAt, completedAt });
      })
      .catch(() => {
        lastJobTimes.set(key, { startedAt, completedAt: new Date().toISOString() });
      })
      .finally(() => {
        activeJobs.delete(key);
        activeJobStartedAt.delete(key);
      });
    return { status: 'started' as const, maxTracks: options.maxTracks ?? null };
  }

  public async enrichUserWithLyrics(
    userId: string,
    options: { maxTracks?: number } = {},
  ): Promise<MusicLanguageEnrichmentResult> {
    const scope: Prisma.MusicTrackWhereInput = { library: { userId } };
    const result = await this.run(scope, {});
    await this.enrichCachedLyrics(scope, result);
    if (this.lyricsLookup) await this.enrichMissingLyrics(scope, result, options.maxTracks);
    return result;
  }

  public enrichLibrary(
    libraryId: string,
    options: { batchSize?: number; maxBatches?: number } = {},
  ) {
    return this.runExclusive(`library:${libraryId}`, { libraryId }, options);
  }

  private runExclusive(
    key: string,
    scope: Prisma.MusicTrackWhereInput,
    options: { batchSize?: number; maxBatches?: number },
  ) {
    const existing = activeJobs.get(key);
    if (existing) return existing;
    const job = this.run(scope, options).finally(() => activeJobs.delete(key));
    activeJobs.set(key, job);
    return job;
  }

  private async run(
    scope: Prisma.MusicTrackWhereInput,
    options: { batchSize?: number; maxBatches?: number },
  ): Promise<MusicLanguageEnrichmentResult> {
    const batchSize = Math.max(25, Math.min(250, options.batchSize || MUSIC_LANGUAGE_BATCH_SIZE));
    const maxBatches = Math.max(1, Math.min(1000, options.maxBatches || 1000));
    const result: MusicLanguageEnrichmentResult = {
      processed: 0,
      updated: 0,
      known: 0,
      unknown: 0,
      batches: 0,
      lyricsChecked: 0,
      lyricsFetched: 0,
      lyricsNotFound: 0,
      lyricsFailed: 0,
      providerLookups: 0,
      providerHttp429: 0,
      providerHttp5xx: 0,
      languagesResolvedThisRun: 0,
      version: MUSIC_LANGUAGE_DETECTION_VERSION,
    };

    while (result.batches < maxBatches) {
      const tracks = await this.prisma.musicTrack.findMany({
        where: { AND: [scope, pendingLanguageWhere], driveFile: { status: 'active' } },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: trackSelect,
      });
      if (!tracks.length) break;

      const resolved = tracks.map((track) => ({
        track,
        evidence: resolveTrackLanguageEvidence({
          persistedLanguage: track.languageCode,
          persistedSource: track.languageSource,
          persistedConfidence: track.languageConfidence,
          lyricsLanguage: track.lyrics?.language,
          lyricsContent: track.lyrics?.content,
          lyricsSourceType: track.lyrics?.sourceType,
          genres: parseGenres(track.genres),
          albumGenres: parseGenres(track.album?.genres),
        }),
      }));
      await this.persistResolvedBatch(
        resolved.map(({ track, evidence }) => ({ id: track.id, evidence })),
      );

      result.batches += 1;
      result.processed += tracks.length;
      result.updated += tracks.length;
      result.known += resolved.filter(({ evidence }) => evidence.language !== null).length;
      result.unknown += resolved.filter(({ evidence }) => evidence.language === null).length;
      result.languagesResolvedThisRun += resolved.filter(
        ({ track, evidence }) => !track.languageCode && evidence.language !== null,
      ).length;
    }
    return result;
  }

  private async persistResolvedBatch(
    resolved: Array<{ id: string; evidence: TrackLanguageEvidence }>,
  ) {
    const now = new Date();
    const evidenceGroups = new Map<
      string,
      { ids: string[]; evidence: TrackLanguageEvidence; confidence: number }
    >();
    for (const { id, evidence } of resolved) {
      const confidence = Math.round(evidence.confidence * 100) / 100;
      const key = `${evidence.language || ''}\u0000${evidence.source}\u0000${confidence}`;
      const group = evidenceGroups.get(key) || { ids: [], evidence, confidence };
      group.ids.push(id);
      evidenceGroups.set(key, group);
    }
    if (!evidenceGroups.size) return;
    await this.prisma.$transaction(
      [...evidenceGroups.values()].map(({ ids, evidence, confidence }) =>
        this.prisma.musicTrack.updateMany({
          where: { id: { in: ids }, ...nonManualLanguageWhere },
          data: {
            languageCode: evidence.language,
            languageSource: evidence.source,
            languageConfidence: confidence,
            languageDetectionVersion: MUSIC_LANGUAGE_DETECTION_VERSION,
            languageUpdatedAt: now,
          },
        }),
      ),
    );
  }

  private async enrichCachedLyrics(
    scope: Prisma.MusicTrackWhereInput,
    result: MusicLanguageEnrichmentResult,
  ) {
    let afterId: string | undefined;
    while (true) {
      const tracks = await this.prisma.musicTrack.findMany({
        where: {
          AND: [scope, nonManualLanguageWhere],
          id: afterId ? { gt: afterId } : undefined,
          languageCode: null,
          driveFile: { status: 'active' },
          lyrics: { isNot: null },
        },
        orderBy: { id: 'asc' },
        take: MUSIC_LANGUAGE_BATCH_SIZE,
        select: trackSelect,
      });
      if (!tracks.length) break;
      const resolved = tracks.map((track) => ({
        id: track.id,
        evidence: resolveTrackLanguageEvidence({
          lyricsLanguage: track.lyrics?.language,
          lyricsContent: track.lyrics?.content,
          lyricsSourceType: track.lyrics?.sourceType,
          genres: parseGenres(track.genres),
          albumGenres: parseGenres(track.album?.genres),
        }),
      }));
      await this.persistResolvedBatch(resolved);
      result.lyricsChecked += tracks.length;
      result.known += resolved.filter(({ evidence }) => evidence.language !== null).length;
      result.unknown += resolved.filter(({ evidence }) => evidence.language === null).length;
      result.languagesResolvedThisRun += resolved.filter(
        ({ evidence }) => evidence.language !== null,
      ).length;
      afterId = tracks.at(-1)!.id;
    }
  }

  private async enrichMissingLyrics(
    scope: Prisma.MusicTrackWhereInput,
    result: MusicLanguageEnrichmentResult,
    maxTracks?: number,
  ) {
    const lookup = this.lyricsLookup!;
    let providerTracksChecked = 0;
    const pilotIds =
      maxTracks === undefined ? null : await this.loadDeterministicPilotIds(scope, maxTracks);
    let pilotOffset = 0;
    while (
      pilotIds === null
        ? maxTracks === undefined || providerTracksChecked < maxTracks
        : pilotOffset < pilotIds.length
    ) {
      const now = new Date();
      const staleLease = new Date(now.getTime() - LYRICS_LOOKUP_LEASE_MS);
      const pilotBatchIds = pilotIds?.slice(
        pilotOffset,
        pilotOffset + MUSIC_LYRICS_ENRICHMENT_BATCH_SIZE,
      );
      if (pilotBatchIds) pilotOffset += pilotBatchIds.length;
      const tracks = await this.prisma.musicTrack.findMany({
        where: {
          AND: [
            scope,
            nonManualLanguageWhere,
            ...(pilotBatchIds ? [{ id: { in: pilotBatchIds } }] : []),
            {
              OR: [
                { lyricsEnrichmentStatus: null },
                {
                  lyricsEnrichmentStatus: { in: ['failed', 'not_found'] },
                  lyricsEnrichmentRetryAt: { lte: now },
                },
                {
                  lyricsEnrichmentStatus: 'processing',
                  lyricsEnrichmentUpdatedAt: { lt: staleLease },
                },
              ],
            },
          ],
          languageCode: null,
          driveFile: { status: 'active' },
          lyrics: { is: null },
          primaryArtist: { isNot: null },
          album: { isNot: null },
          duration: { gt: 0 },
        },
        orderBy: { id: 'asc' },
        take: Math.min(
          MUSIC_LYRICS_ENRICHMENT_BATCH_SIZE,
          maxTracks === undefined ? MUSIC_LYRICS_ENRICHMENT_BATCH_SIZE : maxTracks - providerTracksChecked,
        ),
        select: {
          id: true,
          title: true,
          duration: true,
          lyricsEnrichmentAttempts: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true } },
        },
      });
      if (!tracks.length) {
        if (pilotIds) continue;
        break;
      }

      await this.prisma.musicTrack.updateMany({
        where: { id: { in: tracks.map((track) => track.id) }, ...nonManualLanguageWhere },
        data: { lyricsEnrichmentStatus: 'processing', lyricsEnrichmentUpdatedAt: now },
      });

      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(MUSIC_LYRICS_ENRICHMENT_CONCURRENCY, tracks.length) },
        async () => {
          while (cursor < tracks.length) {
            const track = tracks[cursor++]!;
            providerTracksChecked += 1;
            result.providerLookups += 1;
            const attempt = track.lyricsEnrichmentAttempts + 1;
            result.lyricsChecked += 1;
            try {
              const lookupResult = await lookup.lookupOnlineLyrics({
                trackId: track.id,
                title: track.title,
                artist: track.primaryArtist!.name,
                album: track.album!.title,
                duration: track.duration!,
                onProviderResponse: (status) => {
                  if (status === 429) result.providerHttp429 += 1;
                  else if (status >= 500) result.providerHttp5xx += 1;
                },
              });
              if (lookupResult.status === 'found') {
                result.lyricsFetched += 1;
                if (lookupResult.languageResolved) result.languagesResolvedThisRun += 1;
                await this.prisma.musicTrack.updateMany({
                  where: { id: track.id, ...nonManualLanguageWhere },
                  data: {
                    lyricsEnrichmentStatus: 'found',
                    lyricsEnrichmentAttempts: attempt,
                    lyricsEnrichmentRetryAt: null,
                    lyricsEnrichmentUpdatedAt: new Date(),
                  },
                });
              } else {
                result.lyricsNotFound += 1;
                await this.prisma.musicTrack.updateMany({
                  where: { id: track.id, ...nonManualLanguageWhere },
                  data: {
                    lyricsEnrichmentStatus: 'not_found',
                    lyricsEnrichmentAttempts: attempt,
                    lyricsEnrichmentRetryAt: new Date(Date.now() + LYRICS_NOT_FOUND_RETRY_MS),
                    lyricsEnrichmentUpdatedAt: new Date(),
                  },
                });
              }
            } catch {
              result.lyricsFailed += 1;
              const retryMs = Math.min(24 * 60 * 60 * 1000, 60_000 * 5 ** Math.min(attempt - 1, 5));
              await this.prisma.musicTrack.updateMany({
                where: { id: track.id, ...nonManualLanguageWhere },
                data: {
                  lyricsEnrichmentStatus: 'failed',
                  lyricsEnrichmentAttempts: attempt,
                  lyricsEnrichmentRetryAt: new Date(Date.now() + retryMs),
                  lyricsEnrichmentUpdatedAt: new Date(),
                },
              });
            }
          }
        },
      );
      await Promise.all(workers);
    }
  }

  private async loadDeterministicPilotIds(
    scope: Prisma.MusicTrackWhereInput,
    maxTracks: number,
  ): Promise<string[]> {
    const now = new Date();
    const staleLease = new Date(now.getTime() - LYRICS_LOOKUP_LEASE_MS);
    const eligible = await this.prisma.musicTrack.findMany({
      where: {
        AND: [
          scope,
          nonManualLanguageWhere,
          {
            OR: [
              { lyricsEnrichmentStatus: null },
              {
                lyricsEnrichmentStatus: { in: ['failed', 'not_found'] },
                lyricsEnrichmentRetryAt: { lte: now },
              },
              {
                lyricsEnrichmentStatus: 'processing',
                lyricsEnrichmentUpdatedAt: { lt: staleLease },
              },
            ],
          },
        ],
        languageCode: null,
        driveFile: { status: 'active' },
        lyrics: { is: null },
        primaryArtist: { isNot: null },
        album: { isNot: null },
        duration: { gt: 0 },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return selectDeterministicPilotIds(
      eligible.map((track) => track.id),
      maxTracks,
    );
  }

  public async enrichTrackFromLyrics(
    trackId: string,
    lyrics: { language?: string | null; content: string; sourceType: string },
  ) {
    const evidence = resolveTrackLanguageEvidence({
      lyricsLanguage: lyrics.language,
      lyricsContent: lyrics.content,
      lyricsSourceType: lyrics.sourceType,
    });
    if (!evidence.language) {
      await this.prisma.musicTrack.updateMany({
        where: { id: trackId, ...nonManualLanguageWhere },
        data: {
          languageCode: null,
          languageSource: null,
          languageConfidence: null,
          languageDetectionVersion: null,
          languageUpdatedAt: null,
          lyricsEnrichmentStatus: 'found',
          lyricsEnrichmentRetryAt: null,
          lyricsEnrichmentUpdatedAt: new Date(),
        },
      });
      return evidence;
    }
    await this.persistEvidence(trackId, evidence);
    return evidence;
  }

  public async invalidateLyricsEvidence(trackId: string) {
    await this.prisma.$transaction([
      this.prisma.musicTrack.updateMany({
        where: {
          id: trackId,
          languageSource: { in: ['lyrics_metadata', 'lyrics_detected'] },
        },
        data: {
          languageCode: null,
          languageSource: null,
          languageConfidence: null,
          languageDetectionVersion: null,
          languageUpdatedAt: null,
        },
      }),
      this.prisma.musicTrack.updateMany({
        where: { id: trackId, ...nonManualLanguageWhere },
        data: {
          lyricsEnrichmentStatus: null,
          lyricsEnrichmentAttempts: 0,
          lyricsEnrichmentRetryAt: null,
          lyricsEnrichmentUpdatedAt: null,
        },
      }),
    ]);
  }

  private async persistEvidence(trackId: string, evidence: TrackLanguageEvidence) {
    await this.prisma.musicTrack.updateMany({
      where: evidence.source === 'manual' ? { id: trackId } : { id: trackId, ...nonManualLanguageWhere },
      data: {
        languageCode: evidence.language,
        languageSource: evidence.source,
        languageConfidence: evidence.confidence,
        languageDetectionVersion: MUSIC_LANGUAGE_DETECTION_VERSION,
        languageUpdatedAt: new Date(),
        ...(evidence.source === 'lyrics_metadata' || evidence.source === 'lyrics_detected'
          ? {
              lyricsEnrichmentStatus: 'found',
              lyricsEnrichmentRetryAt: null,
              lyricsEnrichmentUpdatedAt: new Date(),
            }
          : {}),
      },
    });
  }

  public async stats(userId: string) {
    const where: Prisma.MusicTrackWhereInput = {
      library: { userId },
      driveFile: { status: 'active' },
    };
    const now = new Date();
    const [
      total,
      languageGroups,
      sourceGroups,
      lyricsAvailable,
      pendingEnrichment,
      queueGroups,
      queued,
      retryWaiting,
    ] = await Promise.all([
      this.prisma.musicTrack.count({ where }),
      this.prisma.musicTrack.groupBy({
        by: ['languageCode'],
        where,
        _count: { _all: true },
      }),
      this.prisma.musicTrack.groupBy({
        by: ['languageSource'],
        where,
        _count: { _all: true },
      }),
      this.prisma.musicTrack.count({ where: { AND: [where, { lyrics: { isNot: null } }] } }),
      this.prisma.musicTrack.count({
        where: {
          AND: [where, nonManualLanguageWhere],
          languageCode: null,
          lyrics: { is: null },
          primaryArtist: { isNot: null },
          album: { isNot: null },
          duration: { gt: 0 },
        },
      }),
      this.prisma.musicTrack.groupBy({
        by: ['lyricsEnrichmentStatus'],
        where,
        _count: { _all: true },
      }),
      this.prisma.musicTrack.count({
        where: {
          AND: [where, nonManualLanguageWhere],
          languageCode: null,
          lyrics: { is: null },
          primaryArtist: { isNot: null },
          album: { isNot: null },
          duration: { gt: 0 },
          lyricsEnrichmentStatus: null,
        },
      }),
      this.prisma.musicTrack.count({
        where: {
          AND: [where, nonManualLanguageWhere],
          lyricsEnrichmentStatus: { in: ['failed', 'not_found'] },
          lyricsEnrichmentRetryAt: { gt: now },
        },
      }),
    ]);
    const languages = Object.fromEntries(
      languageGroups
        .filter((group) => group.languageCode)
        .map((group) => [group.languageCode!, group._count._all]),
    );
    const sources = Object.fromEntries(
      sourceGroups
        .filter((group) => group.languageSource)
        .map((group) => [group.languageSource!, group._count._all]),
    );
    const known = Object.values(languages).reduce((sum, count) => sum + count, 0);
    const queueStatuses = Object.fromEntries(
      queueGroups
        .filter((group) => group.lyricsEnrichmentStatus)
        .map((group) => [group.lyricsEnrichmentStatus!, group._count._all]),
    );
    const key = `user:${userId}`;
    const last = lastJobs.get(key) || null;
    const lastTimes = lastJobTimes.get(key) || null;
    return {
      total,
      known,
      unknown: total - known,
      lyricsAvailable,
      lyricsMissing: total - lyricsAvailable,
      pendingEnrichment,
      queued,
      processing: queueStatuses.processing || 0,
      completed: queueStatuses.found || 0,
      notFound: queueStatuses.not_found || 0,
      retryWaiting,
      failed: queueStatuses.failed || 0,
      lyricsDetected: (sources.lyrics_detected || 0) + (sources.lyrics_metadata || 0),
      languagesResolvedThisRun: last?.languagesResolvedThisRun || 0,
      providerLookups: last?.providerLookups || 0,
      providerHttp429: last?.providerHttp429 || 0,
      providerHttp5xx: last?.providerHttp5xx || 0,
      lastJobStartedAt: activeJobStartedAt.get(key) || lastTimes?.startedAt || null,
      lastJobCompletedAt: lastTimes?.completedAt || null,
      languages,
      sources,
      version: MUSIC_LANGUAGE_DETECTION_VERSION,
      job: {
        status: activeJobs.has(key) ? ('running' as const) : ('idle' as const),
        startedAt: activeJobStartedAt.get(key) || null,
        last,
      },
    };
  }
}

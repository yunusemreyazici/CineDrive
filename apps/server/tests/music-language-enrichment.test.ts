import type { PrismaClient } from '@cinedrive/prisma';
import { describe, expect, it, vi } from 'vitest';
import {
  detectLanguageFromGenres,
  detectLyricsLanguage,
  isHardLanguageEvidenceAccepted,
  normalizeMusicLanguageCode,
  resolveTrackLanguageEvidence,
} from '../src/services/music-language-evidence.js';
import {
  MusicLanguageEnrichmentService,
  selectDeterministicPilotIds,
} from '../src/services/music-language-enrichment.service.js';

const turkishLyrics = `
[ar:Örnek]
[00:01.00]Bu gece yine seni düşündüm, kalbimde bir umut var
[00:05.00]Benimle kal sevgilim, yollar uzun olsa da
[00:09.00]Seni sevmekten vazgeçmem çünkü hayat seninle güzel
[00:13.00]Bütün dünya bizim olsun, şimdi ellerimi bırakma
[00:17.00]Bir gün yeniden güneş doğacak ve biz yine güleceğiz
[00:21.00]Ne olursa olsun seni bekleyeceğim, bunu unutma
`;

const englishLyrics = `
[00:01.00]I remember when we were young and free under the stars
[00:05.00]You held my hand and told me that our love would never end
[00:09.00]Because we belong together and my heart is always with you
[00:13.00]Through every night and every road I will be by your side
[00:17.00]When morning comes we will begin this beautiful life again
[00:21.00]And all the dreams we shared will carry us back home
`;

describe('music language evidence', () => {
  it.each([
    ['tr', 'tr'],
    ['turkish', 'tr'],
    ['tr-TR', 'tr'],
    ['tr_TR', 'tr'],
    ['English', 'en'],
    ['invalid-language', null],
    ['unknown', null],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMusicLanguageCode(input)).toBe(expected);
  });

  it('accepts valid lyrics metadata as the strongest non-manual evidence', () => {
    expect(
      resolveTrackLanguageEvidence({
        lyricsLanguage: 'tr-TR',
        lyricsContent: englishLyrics,
        lyricsSourceType: 'sidecar',
        genres: ['English Pop'],
      }),
    ).toEqual({ language: 'tr', source: 'lyrics_metadata', confidence: 1 });
  });

  it('detects sufficiently long Turkish and English lyrics locally with high confidence', () => {
    const turkish = detectLyricsLanguage(turkishLyrics);
    const english = detectLyricsLanguage(englishLyrics);
    expect(turkish).toMatchObject({ language: 'tr', source: 'lyrics_detected' });
    expect(english).toMatchObject({ language: 'en', source: 'lyrics_detected' });
    expect(turkish!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(english!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(isHardLanguageEvidenceAccepted(turkish!)).toBe(true);
    expect(isHardLanguageEvidenceAccepted(english!)).toBe(true);
  });

  it('keeps short and ambiguous lyrics unknown', () => {
    expect(detectLyricsLanguage('[00:01.00]Love you')).toBeNull();
    expect(resolveTrackLanguageEvidence({ lyricsContent: 'la la la la' })).toEqual({
      language: null,
      source: 'unknown',
      confidence: 0,
    });
  });

  it('uses only explicit language-bearing genre evidence', () => {
    expect(detectLanguageFromGenres(['Turkish Pop'])).toEqual({
      language: 'tr',
      source: 'genre',
      confidence: 0.96,
    });
    expect(detectLanguageFromGenres(['Türkçe Rock'])).toMatchObject({ language: 'tr' });
    expect(detectLanguageFromGenres(['Anatolian Rock'])).toMatchObject({ language: 'tr' });
    expect(detectLanguageFromGenres(['Pop'])).toBeNull();
    expect(detectLanguageFromGenres(['Rock'])).toBeNull();
  });

  it('lets lyrics language override a conflicting language-bearing genre', () => {
    expect(
      resolveTrackLanguageEvidence({
        lyricsLanguage: 'en',
        lyricsContent: turkishLyrics,
        genres: ['Turkish Rock'],
      }),
    ).toEqual({ language: 'en', source: 'lyrics_metadata', confidence: 1 });
  });

  it('does not accept artist-locale-only evidence for a hard language constraint', () => {
    expect(
      isHardLanguageEvidenceAccepted({
        language: 'tr',
        source: 'artist_locale',
        confidence: 0.8,
      }),
    ).toBe(false);
  });
});

describe('music language enrichment batches', () => {
  it('samples a bounded pilot deterministically across the full eligible queue', () => {
    const ids = Array.from({ length: 1_000 }, (_, index) => `track-${index.toString().padStart(4, '0')}`);
    const sample = selectDeterministicPilotIds(ids, 200);

    expect(sample).toHaveLength(200);
    expect(sample.slice(0, 3)).toEqual(['track-0002', 'track-0007', 'track-0012']);
    expect(sample.slice(-3)).toEqual(['track-0987', 'track-0992', 'track-0997']);
    expect(selectDeterministicPilotIds(ids, 200)).toEqual(sample);
  });

  it('processes 10,000 tracks in bounded batches and is idempotent', async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `track-${index.toString().padStart(5, '0')}`,
      genres: index % 2 ? '["Turkish Pop"]' : '["Pop"]',
      languageCode: null as string | null,
      languageSource: null as string | null,
      languageConfidence: null as number | null,
      languageDetectionVersion: null as number | null,
      languageUpdatedAt: null as Date | null,
      lyrics: null,
      album: { genres: null },
    }));
    const findMany = vi.fn(async ({ take }: { take: number }) =>
      rows.filter((row) => row.languageDetectionVersion === null).slice(0, take),
    );
    const updateMany = vi.fn(
      async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        const ids = new Set(where.id.in);
        rows.filter((item) => ids.has(item.id)).forEach((row) => Object.assign(row, data));
        return { count: ids.size };
      },
    );
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    const prisma = {
      musicTrack: { findMany, updateMany },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const service = new MusicLanguageEnrichmentService(prisma);

    const first = await service.enrichUser('user-1');
    expect(first).toMatchObject({ processed: 10_000, updated: 10_000, batches: 50 });
    expect(findMany).toHaveBeenCalledTimes(51);
    expect(transaction).toHaveBeenCalledTimes(50);
    expect(updateMany).toHaveBeenCalledTimes(100);

    findMany.mockClear();
    transaction.mockClear();
    updateMany.mockClear();
    const second = await service.enrichUser('user-1');
    expect(second).toMatchObject({ processed: 0, updated: 0, batches: 0 });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('processes cached lyrics before fetching missing lyrics with bounded concurrency', async () => {
    const events: string[] = [];
    const cachedTrack = {
      id: 'cached-track',
      genres: '["Pop"]',
      languageCode: null,
      languageSource: null,
      languageConfidence: null,
      lyrics: { language: null, content: turkishLyrics, sourceType: 'sidecar' },
      album: { genres: null },
    };
    const missingTracks = Array.from({ length: 5 }, (_, index) => ({
      id: `missing-${index}`,
      title: `Missing ${index}`,
      duration: 180,
      lyricsEnrichmentAttempts: 0,
      primaryArtist: { name: 'Test Artist' },
      album: { title: 'Test Album' },
    }));
    let findCall = 0;
    const findMany = vi.fn(
      async ({
        take,
        select,
        where,
      }: {
        take?: number;
        select?: { id?: boolean };
        where?: { AND?: unknown[] };
      }) => {
        findCall += 1;
        if (findCall === 1) return [];
        if (findCall === 2) return [cachedTrack];
        if (findCall === 3) return [];
        if (findCall === 4 && select?.id) return missingTracks.map(({ id }) => ({ id }));
        if (findCall === 5) {
          const idFilter = where?.AND?.find(
            (part): part is { id: { in: string[] } } =>
              Boolean(part && typeof part === 'object' && 'id' in part),
          );
          return missingTracks
            .filter((track) => idFilter?.id.in.includes(track.id))
            .slice(0, take);
        }
        return [];
      },
    );
    const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
    const updateMany = vi.fn(async ({ where, data }) => {
      updates.push({ where, data });
      if (data.languageCode === 'tr') events.push('cached');
      return { count: 1 };
    });
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    let active = 0;
    let maxActive = 0;
    const lookupOnlineLyrics = vi.fn(async ({
      trackId,
      onProviderResponse,
    }: {
      trackId: string;
      onProviderResponse?: (status: number) => void;
    }) => {
      events.push(`lookup:${trackId}`);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (trackId === 'missing-0') {
        onProviderResponse?.(429);
        onProviderResponse?.(503);
      }
      if (trackId === 'missing-4') throw new Error('mock provider unavailable');
      if (trackId === 'missing-2') return { status: 'not_found' as const };
      return { status: 'found' as const, languageResolved: true };
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const prisma = {
      musicTrack: { findMany, updateMany },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const service = new MusicLanguageEnrichmentService(prisma, { lookupOnlineLyrics });

    const result = await service.enrichUserWithLyrics('user-1', { maxTracks: 3 });

    expect(events[0]).toBe('cached');
    expect(lookupOnlineLyrics).toHaveBeenCalledTimes(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result).toMatchObject({
      lyricsChecked: 4,
      lyricsFetched: 1,
      lyricsNotFound: 1,
      lyricsFailed: 1,
      providerLookups: 3,
      providerHttp429: 1,
      providerHttp5xx: 1,
      languagesResolvedThisRun: 2,
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ languageCode: 'tr' }) }),
        expect.objectContaining({
          data: expect.objectContaining({ lyricsEnrichmentStatus: 'not_found' }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({ lyricsEnrichmentStatus: 'failed' }),
        }),
      ]),
    );
  });

  it('reports lyrics availability and pending language enrichment', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { languageCode: 'tr', _count: { _all: 3 } },
        { languageCode: null, _count: { _all: 7 } },
      ])
      .mockResolvedValueOnce([
        { languageSource: 'lyrics_detected', _count: { _all: 3 } },
        { languageSource: null, _count: { _all: 7 } },
      ])
      .mockResolvedValueOnce([
        { lyricsEnrichmentStatus: 'processing', _count: { _all: 1 } },
        { lyricsEnrichmentStatus: 'found', _count: { _all: 2 } },
        { lyricsEnrichmentStatus: 'not_found', _count: { _all: 1 } },
        { lyricsEnrichmentStatus: 'failed', _count: { _all: 1 } },
      ]);
    const prisma = { musicTrack: { count, groupBy } } as unknown as PrismaClient;

    await expect(new MusicLanguageEnrichmentService(prisma).stats('user-1')).resolves.toMatchObject({
      total: 10,
      known: 3,
      unknown: 7,
      lyricsAvailable: 4,
      lyricsMissing: 6,
      pendingEnrichment: 6,
      queued: 5,
      processing: 1,
      completed: 2,
      notFound: 1,
      retryWaiting: 2,
      failed: 1,
      lyricsDetected: 3,
      languagesResolvedThisRun: 0,
      providerLookups: 0,
      providerHttp429: 0,
      providerHttp5xx: 0,
      lastJobStartedAt: null,
      lastJobCompletedAt: null,
    });
  });

  it('reports the last background job start and completion timestamps', async () => {
    const prisma = {
      musicTrack: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const service = new MusicLanguageEnrichmentService(prisma);

    expect(service.startUser('timing-user', { maxTracks: 12 })).toEqual({
      status: 'started',
      maxTracks: 12,
    });
    await vi.waitFor(async () => {
      expect((await service.stats('timing-user')).job.status).toBe('idle');
    });
    const stats = await service.stats('timing-user');
    expect(stats.lastJobStartedAt).toEqual(expect.any(String));
    expect(stats.lastJobCompletedAt).toEqual(expect.any(String));
    expect(stats.job.last).toMatchObject({
      startedAt: stats.lastJobStartedAt,
      completedAt: stats.lastJobCompletedAt,
      languagesResolvedThisRun: 0,
    });
  });
});

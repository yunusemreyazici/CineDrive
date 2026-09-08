import { createHash } from 'node:crypto';
import type { PrismaClient } from '@cinedrive/prisma';
import {
  musicEditorialPlansProviderSchema,
  playlistIntentSchema,
  type MusicEditorialEditionDto,
  type MusicEditorialSlot,
  type PlaylistIntent,
  type PlaylistIntentProviderOutput,
} from '@cinedrive/shared';
import { accessibleLibraryFilter } from '../utils/library-access.js';
import { findMusicTracksByIdsWithRelations, formatMusicTrack } from '../utils/music-format.js';
import { loadDiscoveryCandidates, type DiscoveryCandidate } from './music-discovery-candidates.js';
import { normalizeGenre } from './music-discovery.service.js';
import { createDiscoverySelectionContext, stableNumber } from './music-discovery-selection.js';
import { buildMusicCatalogueSummary, normalizePlaylistIntent } from './music-ai-intent.js';
import type {
  MusicAiProvider,
  MusicCatalogueSummary,
  MusicEditorialListenerProfile,
} from './music-ai-provider.js';
import {
  catalogueFingerprint,
  selectAiPlaylistCandidates,
  type AiPlaylistHistoryEntry,
} from './music-ai-playlist.service.js';

const HISTORY_LIMIT = 2_000;
const EDITORIAL_SLOTS: MusicEditorialSlot[] = [
  'daily',
  'rediscovery',
  'comfort',
  'crossover',
  'time-capsule',
];
const ACCENTS = ['violet', 'cyan', 'indigo', 'rose', 'amber'];

export interface NormalizedEditorialPlan {
  slot: MusicEditorialSlot;
  intent: PlaylistIntent;
}

const isMeaningfulListen = (entry: AiPlaylistHistoryEntry) => {
  const threshold = entry.track.duration ? Math.min(30, entry.track.duration * 0.45) : 15;
  return entry.listenedSeconds >= threshold;
};

export const buildEditorialListenerProfile = (
  candidates: DiscoveryCandidate[],
  history: AiPlaylistHistoryEntry[],
): MusicEditorialListenerProfile => {
  const genreStats = new Map<string, { count: number; affinity: number }>();
  const decadeStats = new Map<number, { count: number; affinity: number }>();
  const languageCounts = new Map<string, number>();
  let favoriteTrackCount = 0;
  let playedTrackCount = 0;
  let unheardTrackCount = 0;
  let underplayedTrackCount = 0;

  for (const candidate of candidates) {
    favoriteTrackCount += candidate.isFavorite ? 1 : 0;
    playedTrackCount += candidate.playCount > 0 ? 1 : 0;
    unheardTrackCount += candidate.playCount === 0 ? 1 : 0;
    underplayedTrackCount += candidate.playCount <= 1 ? 1 : 0;
    const affinity =
      Math.min(1, Math.log1p(candidate.playCount) / Math.log(12)) * 0.7 +
      (candidate.isFavorite ? 0.3 : 0);
    const genres = new Set(
      [...candidate.genres, ...candidate.albumGenres].map(normalizeGenre).filter(Boolean),
    );
    for (const genre of genres) {
      const current = genreStats.get(genre) || { count: 0, affinity: 0 };
      current.count += 1;
      current.affinity += affinity;
      genreStats.set(genre, current);
    }
    const year = candidate.year || candidate.albumYear;
    if (year && year >= 1800 && year <= 3000) {
      const decade = Math.floor(year / 10) * 10;
      const current = decadeStats.get(decade) || { count: 0, affinity: 0 };
      current.count += 1;
      current.affinity += affinity;
      decadeStats.set(decade, current);
    }
    if (candidate.languageCode) {
      const code = candidate.languageCode.toLocaleLowerCase('en-US');
      languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
    }
  }

  return {
    totalTrackCount: candidates.length,
    favoriteTrackCount,
    playedTrackCount,
    unheardTrackCount,
    underplayedTrackCount,
    meaningfulHistoryCount: history.filter(isMeaningfulListen).length,
    genres: [...genreStats.entries()]
      .sort((left, right) => right[1].affinity - left[1].affinity || right[1].count - left[1].count)
      .slice(0, 16)
      .map(([name, value]) => ({
        name,
        count: value.count,
        affinity: Number((value.affinity / Math.max(1, value.count)).toFixed(3)),
      })),
    decades: [...decadeStats.entries()]
      .sort((left, right) => right[1].affinity - left[1].affinity || right[1].count - left[1].count)
      .slice(0, 10)
      .map(([decade, value]) => ({
        decade,
        count: value.count,
        affinity: Number((value.affinity / Math.max(1, value.count)).toFixed(3)),
      })),
    languages: [...languageCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([code, count]) => ({ code, count })),
  };
};

const copy = <T>(value: T): T => structuredClone(value);

const baseIntent = (title: string, subtitle: string): PlaylistIntentProviderOutput => ({
  title,
  subtitle,
  targetCount: 45,
  genres: [],
  excludedGenres: [],
  artists: [],
  excludedArtistNames: [],
  year: { min: null, max: null, weight: 0, mode: 'soft' },
  language: { languages: [], excludedLanguages: [], weight: 0, mode: 'soft' },
  locale: { countries: [], scenes: [], weight: 0, mode: 'soft' },
  exploration: 0.55,
  familiarity: 0.55,
  favoriteBias: 0.35,
  unheardBias: 0.35,
  lowPlayCountBias: 0.35,
  oldLibraryBias: 0.3,
  recentPlayPenalty: 0.55,
  artistDiversity: 0.85,
  albumDiversity: 0.85,
  seedMode: 'balanced',
});

export const buildLocalEditorialPlans = (
  locale: 'tr' | 'en',
  catalogue: MusicCatalogueSummary,
  profile: MusicEditorialListenerProfile,
): NormalizedEditorialPlan[] => {
  const labels: Record<
    'daily' | 'rediscovery' | 'comfort' | 'crossover' | 'capsule',
    readonly [string, string]
  > =
    locale === 'tr'
      ? {
          daily: ['Bugünkü Rotan', 'Sevdiğin seslerle yeni keşifler'],
          rediscovery: ['Yeniden Hatırla', 'Uzun süredir açmadığın parçalar'],
          comfort: ['Güvenli Alan', 'Favorilerinden tanıdık bir akış'],
          crossover: ['Türler Arasında', 'Sevdiğin tarzların buluştuğu seçki'],
          capsule: ['Zaman Kapsülü', 'Kütüphanenden geçmişe açılan bir pencere'],
        }
      : {
          daily: ["Today's Route", 'Familiar sounds with room for discovery'],
          rediscovery: ['Remember These?', 'Tracks waiting to be heard again'],
          comfort: ['Comfort Zone', 'A familiar flow built around favorites'],
          crossover: ['Between Genres', 'A meeting point for your favorite styles'],
          capsule: ['Time Capsule', 'A window into your musical past'],
        };
  const topGenres = profile.genres.slice(0, 2);
  const topDecade = profile.decades[0]?.decade;
  const rawPlans: Array<{ slot: MusicEditorialSlot; intent: PlaylistIntentProviderOutput }> = [];

  const daily = baseIntent(labels.daily[0], labels.daily[1]);
  rawPlans.push({ slot: 'daily', intent: daily });

  const rediscovery = baseIntent(labels.rediscovery[0], labels.rediscovery[1]);
  Object.assign(rediscovery, {
    exploration: 0.9,
    familiarity: 0.25,
    unheardBias: 0.9,
    lowPlayCountBias: 1,
    oldLibraryBias: 0.9,
    recentPlayPenalty: 1,
    seedMode: 'discovery' as const,
  });
  rawPlans.push({ slot: 'rediscovery', intent: rediscovery });

  const comfort = baseIntent(labels.comfort[0], labels.comfort[1]);
  Object.assign(comfort, {
    exploration: 0.2,
    familiarity: 1,
    favoriteBias: 1,
    unheardBias: 0.05,
    lowPlayCountBias: 0.1,
    recentPlayPenalty: 0.35,
    seedMode: 'familiar' as const,
  });
  rawPlans.push({ slot: 'comfort', intent: comfort });

  const crossover = baseIntent(labels.crossover[0], labels.crossover[1]);
  crossover.genres = topGenres.map((genre, index) => ({
    name: genre.name,
    weight: index === 0 ? 0.9 : 0.72,
    mode: 'soft',
  }));
  crossover.exploration = 0.7;
  rawPlans.push({ slot: 'crossover', intent: crossover });

  const capsule = baseIntent(labels.capsule[0], labels.capsule[1]);
  if (topDecade) {
    capsule.year = { min: topDecade, max: topDecade + 9, weight: 0.9, mode: 'soft' };
  }
  capsule.oldLibraryBias = 0.75;
  capsule.recentPlayPenalty = 0.8;
  rawPlans.push({ slot: 'time-capsule', intent: capsule });

  return rawPlans.map(({ slot, intent }) => ({
    slot,
    intent: sanitizeEditorialIntent(normalizePlaylistIntent(intent, catalogue)),
  }));
};

const sanitizeEditorialIntent = (intent: PlaylistIntent): PlaylistIntent =>
  playlistIntentSchema.parse({
    ...intent,
    genres: intent.genres.map((genre) => ({ ...genre, mode: 'soft' as const })),
    excludedGenres: [],
    artists: [],
    excludedArtistNames: [],
    year: { ...intent.year, mode: 'soft' as const },
    language: {
      ...intent.language,
      excludedLanguages: [],
      mode: 'soft' as const,
    },
    locale: { ...intent.locale, mode: 'soft' as const },
  });

export const normalizeEditorialPlans = (
  output: unknown,
  catalogue: MusicCatalogueSummary,
  fallback: NormalizedEditorialPlan[],
): NormalizedEditorialPlan[] => {
  const parsed = musicEditorialPlansProviderSchema.safeParse(output);
  if (!parsed.success) return fallback.map(copy);
  const bySlot = new Map<MusicEditorialSlot, NormalizedEditorialPlan>();
  for (const plan of parsed.data.plans) {
    if (bySlot.has(plan.slot)) continue;
    try {
      bySlot.set(plan.slot, {
        slot: plan.slot,
        intent: sanitizeEditorialIntent(normalizePlaylistIntent(plan.intent, catalogue)),
      });
    } catch {
      // A malformed individual plan is replaced by its deterministic local slot.
    }
  }
  for (const plan of fallback) if (!bySlot.has(plan.slot)) bySlot.set(plan.slot, copy(plan));
  return EDITORIAL_SLOTS.flatMap((slot) => {
    const plan = bySlot.get(slot);
    return plan ? [plan] : [];
  });
};

export const selectEditorialCandidates = (
  candidates: DiscoveryCandidate[],
  history: AiPlaylistHistoryEntry[],
  plans: NormalizedEditorialPlan[],
  editionId: string,
) => {
  const context = createDiscoverySelectionContext();
  return plans.map((plan) => ({
    ...plan,
    candidates: selectAiPlaylistCandidates(
      candidates,
      history,
      plan.intent,
      `${editionId}:${plan.slot}`,
      context,
    ),
  }));
};

const nextUtcDay = (now: Date) => {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
};

export class MusicAiEditorialService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: MusicEditorialEditionDto }
  >();
  private readonly inflight = new Map<string, Promise<MusicEditorialEditionDto>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: MusicAiProvider | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async getEdition(userId: string, locale: 'tr' | 'en'): Promise<MusicEditorialEditionDto> {
    const candidates = await loadDiscoveryCandidates(this.prisma, userId);
    const history = await this.prisma.musicHistory.findMany({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        trackId: true,
        playedAt: true,
        listenedSeconds: true,
        track: { select: { duration: true } },
      },
    });
    const now = this.clock();
    const editionDate = now.toISOString().slice(0, 10);
    const summary = buildMusicCatalogueSummary(candidates);
    const profile = buildEditorialListenerProfile(candidates, history);
    const profileFingerprint = createHash('sha256')
      .update(JSON.stringify(profile))
      .digest('base64url')
      .slice(0, 16);
    const key = `${userId}:${locale}:${editionDate}:${catalogueFingerprint(candidates)}:${profileFingerprint}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now.getTime()) return cached.value;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.generateEdition(
        userId,
        locale,
        editionDate,
        now,
        candidates,
        history,
        summary,
        profile,
      );
      this.inflight.set(key, pending);
    }
    try {
      const value = await pending;
      this.cache.set(key, { expiresAt: new Date(value.expiresAt).getTime(), value });
      return value;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async generateEdition(
    userId: string,
    locale: 'tr' | 'en',
    editionDate: string,
    now: Date,
    candidates: DiscoveryCandidate[],
    history: AiPlaylistHistoryEntry[],
    catalogue: MusicCatalogueSummary,
    profile: MusicEditorialListenerProfile,
  ): Promise<MusicEditorialEditionDto> {
    const fallback = buildLocalEditorialPlans(locale, catalogue, profile);
    let plans = fallback;
    let source: 'ai' | 'local' = 'local';
    if (this.provider?.generateEditorialPlans) {
      try {
        const output = await this.provider.generateEditorialPlans({
          catalogue,
          profile,
          locale,
          editionDate,
        });
        plans = normalizeEditorialPlans(output, catalogue, fallback);
        source = musicEditorialPlansProviderSchema.safeParse(output).success ? 'ai' : 'local';
      } catch {
        plans = fallback;
      }
    }

    const editionId = `editorial-${editionDate}`;
    const selections = selectEditorialCandidates(candidates, history, plans, editionId);
    const selectedIds = selections.flatMap((selection) =>
      selection.candidates.map((candidate) => candidate.id),
    );
    const hydrated = await findMusicTracksByIdsWithRelations(this.prisma, userId, selectedIds, {
      library: accessibleLibraryFilter(userId),
    });
    const tracksById = new Map(hydrated.map(formatMusicTrack).map((track) => [track.id, track]));
    const mixes = selections.map((selection, index) => {
      const tracks = selection.candidates.flatMap((candidate) => {
        const track = tracksById.get(candidate.id);
        return track ? [track] : [];
      });
      return {
        id: `${editionId}-${selection.slot}`,
        type: 'ai' as const,
        title: selection.intent.title,
        subtitle: selection.intent.subtitle,
        accent: ACCENTS[(index + stableNumber(editionId)) % ACCENTS.length]!,
        artworkUrls: [...new Set(tracks.map((track) => track.artworkUrl).filter(Boolean))].slice(
          0,
          4,
        ) as string[],
        tracks,
        candidateCount: candidates.length,
        trackCount: tracks.length,
      };
    });
    return {
      editionId,
      generatedAt: now.toISOString(),
      expiresAt: nextUtcDay(now).toISOString(),
      source,
      mixes,
    };
  }
}

import type { PrismaClient } from '@cinedrive/prisma';
import type {
  MusicArtistDto,
  MusicDiscoveryDto,
  MusicMixDto,
  MusicTrackDto,
} from '@cinedrive/shared';
import { accessibleLibraryFilter } from '../utils/library-access.js';
import {
  findMusicTracksByIdsWithRelations,
  formatMusicTrack,
  parseGenres,
} from '../utils/music-format.js';
import { type DiscoveryCandidate, loadDiscoveryCandidates } from './music-discovery-candidates.js';
import {
  DISCOVERY_LIMITS,
  createDiscoverySelectionContext,
  selectDiscoveryCandidates,
  stableNumber,
} from './music-discovery-selection.js';

const DISCOVERY_CACHE_TTL_MS = 90_000;
const RECENT_TRACK_PENALTY_COUNT = 120;
const RECENT_HISTORY_LIMIT = 1_000;
const MAX_ARTIST_MIXES = 6;
const MAX_GENRE_COLLECTIONS = 10;
const MAX_DECADE_COLLECTIONS = 8;
const MIN_COLLECTION_TRACKS = 4;
const MIN_MOOD_TRACKS = 8;
const accents = ['violet', 'cyan', 'amber', 'rose', 'emerald', 'indigo'];

const dateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const uniqueTracks = (tracks: MusicTrackDto[], limit = tracks.length) => {
  const seen = new Set<string>();
  return tracks.filter((track) => !seen.has(track.id) && seen.add(track.id)).slice(0, limit);
};

export const normalizeGenre = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .trim();

const ignoredGenres = new Set([
  'sports',
  'sport',
  'non music',
  'other',
  'interview',
  'speech',
  'spoken word',
  'audio drama',
]);

const isUsefulGenre = (genre: string) =>
  genre.length >= 3 && !ignoredGenres.has(genre) && !genre.startsWith('music for ');

const normalizedTrackGenres = new WeakMap<MusicTrackDto, string[]>();
const trackGenres = (track: MusicTrackDto) => {
  const cached = normalizedTrackGenres.get(track);
  if (cached) return cached;
  const genres = [
    ...new Set(
      [...track.genres, ...(track.album?.genres || [])].map(normalizeGenre).filter(Boolean),
    ),
  ];
  normalizedTrackGenres.set(track, genres);
  return genres;
};

const normalizedCandidateGenres = new WeakMap<DiscoveryCandidate, string[]>();
const candidateGenres = (candidate: DiscoveryCandidate) => {
  const cached = normalizedCandidateGenres.get(candidate);
  if (cached) return cached;
  const genres = [
    ...new Set([...candidate.genres, ...candidate.albumGenres].map(normalizeGenre).filter(Boolean)),
  ];
  normalizedCandidateGenres.set(candidate, genres);
  return genres;
};

const trackArtistKey = (track: MusicTrackDto) =>
  track.primaryArtist?.id || track.artists[0]?.id || `unknown:${track.id}`;
const trackAlbumKey = (track: MusicTrackDto) => track.album?.id || `single:${track.id}`;
const candidateArtistKey = (candidate: DiscoveryCandidate) =>
  candidate.artistId || `unknown:${candidate.id}`;
const candidateAlbumKey = (candidate: DiscoveryCandidate) =>
  candidate.albumId || `single:${candidate.id}`;

const artistDiversity = <T>(tracks: T[], key: (track: T) => string) =>
  new Set(tracks.map(key)).size;

const cappedDiversityCapacity = (
  tracks: MusicTrackDto[],
  key: (track: MusicTrackDto) => string,
  cap: number,
) => {
  const counts = new Map<string, number>();
  tracks.forEach((track) => counts.set(key(track), (counts.get(key(track)) || 0) + 1));
  return [...counts.values()].reduce((total, count) => total + Math.min(cap, count), 0);
};

/** Backwards-compatible pure helper used by radio and focused unit tests. */
export const diversifyTracks = (
  tracks: MusicTrackDto[],
  score: (track: MusicTrackDto) => number,
  seed: string,
  limit = 30,
  artistLimit = 4,
  albumLimit = 2,
  relaxCaps = true,
) => {
  const ranked = uniqueTracks(tracks)
    .map((track) => ({
      track,
      score: score(track) + (stableNumber(`${seed}:${track.id}`) % 1_000) / 1_000,
    }))
    .sort((left, right) => right.score - left.score);
  const selected: MusicTrackDto[] = [];
  const selectedIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();

  for (const relax of relaxCaps ? [1, 2, Number.POSITIVE_INFINITY] : [1]) {
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      const { track } = candidate;
      if (selectedIds.has(track.id)) continue;
      const artist = trackArtistKey(track);
      const album = trackAlbumKey(track);
      if ((artistCounts.get(artist) || 0) >= artistLimit * relax) continue;
      if ((albumCounts.get(album) || 0) >= albumLimit * relax) continue;
      selected.push(track);
      selectedIds.add(track.id);
      artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
      albumCounts.set(album, (albumCounts.get(album) || 0) + 1);
    }
  }
  return selected;
};

const artworkUrls = (tracks: MusicTrackDto[]) =>
  [...new Set(tracks.map((track) => track.artworkUrl).filter((url): url is string => !!url))].slice(
    0,
    4,
  );

const mix = (
  id: string,
  type: MusicMixDto['type'],
  title: string,
  subtitle: string,
  tracks: MusicTrackDto[],
  accentIndex: number,
  candidateCount = tracks.length,
  description?: string,
  presentation?: Partial<
    Pick<
      MusicMixDto,
      | 'titleKey'
      | 'titleArguments'
      | 'subtitleKey'
      | 'subtitleArguments'
      | 'descriptionKey'
      | 'descriptionArguments'
    >
  >,
): MusicMixDto => {
  const unique = uniqueTracks(tracks);
  return {
    id,
    type,
    title,
    subtitle,
    description,
    accent: accents[accentIndex % accents.length]!,
    artworkUrls: artworkUrls(unique),
    tracks: unique,
    candidateCount,
    trackCount: unique.length,
    ...presentation,
  };
};

const moodRules = [
  { id: 'relax', title: 'Rahatla', genres: ['chill', 'ambient', 'acoustic', 'folk', 'new age'] },
  {
    id: 'focus',
    title: 'Odaklan',
    genres: ['ambient', 'classical', 'instrumental', 'lo-fi', 'jazz'],
  },
  { id: 'energy', title: 'Enerji', genres: ['rock', 'metal', 'dance', 'electronic', 'hip hop'] },
  { id: 'sad', title: 'Hüzünlü', genres: ['sad', 'blues', 'emo', 'melancholy', 'slowcore'] },
  { id: 'romantic', title: 'Romantik', genres: ['romance', 'love', 'r&b', 'soul'] },
  { id: 'party', title: 'Parti', genres: ['party', 'dance', 'pop', 'house', 'disco'] },
  { id: 'memories', title: 'Anıların', genres: ['nostalgia', 'oldies', 'retro', 'classic'] },
  {
    id: 'discover',
    title: 'Keşfet',
    genres: ['alternative', 'indie', 'world', 'experimental'],
  },
];

const decadeTitle = (year: number) => `${Math.floor(year / 10) * 10}'lar`;

export const isMeaningfulDiscoveryListen = (entry: {
  listenedSeconds: number;
  track: { duration: number | null };
}) => {
  const threshold = entry.track.duration ? Math.min(30, entry.track.duration * 0.45) : 15;
  return entry.listenedSeconds >= threshold;
};

interface RadioSeed {
  id: string;
  title: string;
  tracks: MusicTrackDto[];
  artistId?: string;
}

export const buildRadioMix = (
  tracks: MusicTrackDto[],
  historyTrackIds: string[],
  seed: RadioSeed,
): MusicMixDto => {
  const seedGenres = new Set(seed.tracks.flatMap(trackGenres));
  const seedYears = seed.tracks
    .map((track) => track.year || track.album?.year)
    .filter((year): year is number => !!year);
  const centerYear = seedYears.length
    ? seedYears.reduce((total, year) => total + year, 0) / seedYears.length
    : null;
  const recentIndex = new Map(historyTrackIds.map((trackId, index) => [trackId, index]));
  const related = tracks.filter((track) => {
    if (seed.tracks.some((item) => item.id === track.id)) return true;
    if (seed.artistId && track.primaryArtist?.id === seed.artistId) return true;
    if (trackGenres(track).some((genre) => seedGenres.has(genre))) return true;
    const year = track.year || track.album?.year;
    return centerYear !== null && !!year && Math.abs(year - centerYear) <= 6;
  });
  const candidates = related.length >= Math.min(30, tracks.length) ? related : tracks;
  const radioLimit = Math.min(
    DISCOVERY_LIMITS.radio,
    candidates.length,
    cappedDiversityCapacity(candidates, trackArtistKey, 4),
    cappedDiversityCapacity(candidates, trackAlbumKey, 2),
  );
  const selected = diversifyTracks(
    candidates,
    (track) => {
      const overlap = trackGenres(track).filter((genre) => seedGenres.has(genre)).length;
      const year = track.year || track.album?.year;
      const yearAffinity =
        centerYear !== null && year ? Math.max(0, 8 - Math.abs(year - centerYear) * 0.7) : 0;
      const historyIndex = recentIndex.get(track.id);
      const recentPenalty =
        historyIndex === undefined ? -7 : Math.max(0, 18 - Math.log1p(historyIndex) * 3.5);
      return (
        (seed.artistId && track.primaryArtist?.id === seed.artistId ? 22 : 0) +
        overlap * 9 +
        yearAffinity +
        (track.isFavorite ? 5 : 0) -
        recentPenalty -
        Math.log1p(track.playCount || 0) * 1.5
      );
    },
    `radio:${seed.id}:${dateKey()}`,
    radioLimit,
    4,
    2,
    false,
  );
  return mix(
    `radio-${seed.id}`,
    'artist-radio',
    `${seed.title} Radyosu`,
    'Benzer türler, dönemler ve farklı sanatçılardan aralıksız akış',
    selected,
    4,
    candidates.length,
    undefined,
    {
      titleKey: 'music.discovery.radio.title',
      titleArguments: [seed.title],
      subtitleKey: 'music.discovery.radio.subtitle',
    },
  );
};

interface MixPlan {
  id: string;
  type: MusicMixDto['type'];
  title: string;
  subtitle: string;
  accentIndex: number;
  selected: DiscoveryCandidate[];
  candidateCount: number;
  presentation?: Parameters<typeof mix>[8];
}

const materializeMix = (plan: MixPlan, tracksById: Map<string, MusicTrackDto>) =>
  mix(
    plan.id,
    plan.type,
    plan.title,
    plan.subtitle,
    plan.selected.flatMap((candidate) => {
      const track = tracksById.get(candidate.id);
      return track ? [track] : [];
    }),
    plan.accentIndex,
    plan.candidateCount,
    undefined,
    plan.presentation,
  );

export class MusicDiscoveryService {
  private readonly discoveryCache = new Map<
    string,
    { expiresAt: number; value: MusicDiscoveryDto }
  >();
  private readonly discoveryInflight = new Map<string, Promise<MusicDiscoveryDto>>();

  constructor(private readonly prisma: PrismaClient) {}

  public async getDiscovery(
    userId: string,
    requestedGenerationId?: string,
  ): Promise<MusicDiscoveryDto> {
    const generationId = requestedGenerationId || `daily-${dateKey()}`;
    const cacheKey = `${userId}:${generationId}`;
    const now = Date.now();
    for (const [key, entry] of this.discoveryCache) {
      if (entry.expiresAt <= now) this.discoveryCache.delete(key);
    }
    const cached = this.discoveryCache.get(cacheKey);
    if (cached) return cached.value;
    const inflight = this.discoveryInflight.get(cacheKey);
    if (inflight) return inflight;

    const task = this.computeDiscovery(userId, generationId);
    this.discoveryInflight.set(cacheKey, task);
    try {
      const value = await task;
      this.discoveryCache.set(cacheKey, {
        expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
        value,
      });
      return value;
    } finally {
      this.discoveryInflight.delete(cacheKey);
    }
  }

  private async computeDiscovery(userId: string, generationId: string): Promise<MusicDiscoveryDto> {
    const [candidates, history, playbackState] = await Promise.all([
      loadDiscoveryCandidates(this.prisma, userId),
      this.prisma.musicHistory.findMany({
        where: { userId },
        select: {
          trackId: true,
          playedAt: true,
          listenedSeconds: true,
          track: {
            select: {
              albumId: true,
              primaryArtistId: true,
              genres: true,
              duration: true,
              album: { select: { genres: true } },
            },
          },
        },
        orderBy: { playedAt: 'desc' },
        take: RECENT_HISTORY_LIMIT,
      }),
      this.prisma.musicPlaybackState.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const meaningfulHistory = history.filter(isMeaningfulDiscoveryListen);
    const listenedIds = new Set(meaningfulHistory.map((entry) => entry.trackId));
    const recentIndex = new Map(
      meaningfulHistory
        .slice(0, RECENT_TRACK_PENALTY_COUNT)
        .map((entry, index) => [entry.trackId, index]),
    );
    const lastPlayedAt = new Map<string, Date>();
    for (const entry of meaningfulHistory) {
      if (!lastPlayedAt.has(entry.trackId)) lastPlayedAt.set(entry.trackId, entry.playedAt);
    }

    const artistWeights = new Map<string, number>();
    const genreWeights = new Map<string, number>();
    meaningfulHistory.forEach((entry, index) => {
      const completion = entry.track.duration
        ? Math.min(1, entry.listenedSeconds / entry.track.duration)
        : 0.6;
      const weight = Math.max(0.5, 18 * Math.exp(-index / 180) * (0.45 + completion));
      if (entry.track.primaryArtistId)
        artistWeights.set(
          entry.track.primaryArtistId,
          (artistWeights.get(entry.track.primaryArtistId) || 0) + weight,
        );
      [...parseGenres(entry.track.genres), ...parseGenres(entry.track.album?.genres)].forEach(
        (genre) => {
          const key = normalizeGenre(genre);
          genreWeights.set(key, (genreWeights.get(key) || 0) + weight);
        },
      );
    });

    const preferenceScore = (candidate: DiscoveryCandidate) => {
      const artistAffinity = candidate.artistId
        ? Math.log1p(artistWeights.get(candidate.artistId) || 0) * 5
        : 0;
      const genreAffinity = candidateGenres(candidate).reduce(
        (total, genre) => total + Math.log1p(genreWeights.get(genre) || 0) * 2.5,
        0,
      );
      return artistAffinity + genreAffinity + (candidate.isFavorite ? 8 : 0);
    };

    // Tie time-decay to the newest catalogue/listen input. Recomputing an
    // unchanged generation later therefore yields the same weighted ordering.
    let currentTime = 0;
    for (const candidate of candidates)
      currentTime = Math.max(currentTime, candidate.createdAt.getTime());
    for (const entry of meaningfulHistory)
      currentTime = Math.max(currentTime, entry.playedAt.getTime());
    const explorationScore = (candidate: DiscoveryCandidate) => {
      const lastPlayed = lastPlayedAt.get(candidate.id);
      const daysSincePlayed = lastPlayed
        ? Math.max(0, (currentTime - lastPlayed.getTime()) / 86_400_000)
        : 3_650;
      const daysInLibrary = Math.max(0, (currentTime - candidate.createdAt.getTime()) / 86_400_000);
      const recency = recentIndex.get(candidate.id);
      return (
        (!listenedIds.has(candidate.id) ? 32 : 0) +
        Math.log1p(daysSincePlayed) * 4 +
        Math.log1p(daysInLibrary) * 1.5 -
        Math.log1p(candidate.playCount) * 5 -
        (recency === undefined ? 0 : Math.max(18, 58 - recency * 0.45)) +
        (candidate.isFavorite ? 3 : 0)
      );
    };

    const selectionContext = createDiscoverySelectionContext();
    const select = (
      pool: DiscoveryCandidate[],
      seed: string,
      limit: number,
      relevance: (candidate: DiscoveryCandidate) => number = preferenceScore,
    ) =>
      selectDiscoveryCandidates(
        pool.map((candidate) => ({
          value: candidate,
          id: candidate.id,
          artistKey: candidateArtistKey(candidate),
          albumKey: candidateAlbumKey(candidate),
          relevance:
            relevance(candidate) -
            (recentIndex.has(candidate.id) ? 42 : 0) -
            Math.log1p(candidate.playCount) * 1.5,
          exploration: explorationScore(candidate),
        })),
        `${generationId}:${seed}`,
        Math.min(limit, pool.length),
        selectionContext,
      );

    const unheard = candidates.filter((candidate) => !listenedIds.has(candidate.id));
    const dailyPool = unheard.length >= Math.min(12, candidates.length) ? unheard : candidates;
    const dailyPlan: MixPlan = {
      id: `daily-${dateKey()}`,
      type: 'daily',
      title: 'Günlük Keşif',
      subtitle: 'Dinleme alışkanlıkların ve kütüphanenin uzun kuyruğundan hazırlandı',
      selected: select(
        dailyPool,
        'daily',
        DISCOVERY_LIMITS.personalized,
        (candidate) => preferenceScore(candidate) + (listenedIds.has(candidate.id) ? -18 : 24),
      ),
      candidateCount: dailyPool.length,
      accentIndex: 0,
      presentation: {
        titleKey: 'music.discovery.daily.title',
        subtitleKey: 'music.discovery.daily.subtitle',
      },
    };

    const rediscoveryPool = candidates.filter((candidate) => !recentIndex.has(candidate.id));
    const rediscoveryPlan: MixPlan | null = rediscoveryPool.length
      ? {
          id: `rediscovery-${dateKey()}`,
          type: 'rediscovery',
          title: 'Yeniden Keşfet',
          subtitle: 'Bir süredir dinlemediğin güçlü seçimler',
          selected: select(
            rediscoveryPool,
            'rediscovery',
            DISCOVERY_LIMITS.personalized,
            (candidate) => preferenceScore(candidate) + explorationScore(candidate) * 0.45,
          ),
          candidateCount: rediscoveryPool.length,
          accentIndex: 4,
          presentation: {
            titleKey: 'music.discovery.rediscovery.title',
            subtitleKey: 'music.discovery.rediscovery.subtitle',
          },
        }
      : null;

    const favoritePool = candidates.filter((candidate) => candidate.isFavorite);
    const favoritesPlan: MixPlan | null = favoritePool.length
      ? {
          id: `favorites-${dateKey()}`,
          type: 'favorites',
          title: 'Favori Akışı',
          subtitle: 'Favorilerinden çeşitlendirilmiş bir akış',
          selected: select(
            favoritePool,
            'favorites',
            DISCOVERY_LIMITS.personalized,
            preferenceScore,
          ),
          candidateCount: favoritePool.length,
          accentIndex: 3,
          presentation: {
            titleKey: 'music.discovery.favorites.title',
            subtitleKey: 'music.discovery.favorites.subtitle',
          },
        }
      : null;

    const libraryArtistWeights = new Map(artistWeights);
    for (const candidate of candidates) {
      if (!candidate.artistId) continue;
      libraryArtistWeights.set(
        candidate.artistId,
        (libraryArtistWeights.get(candidate.artistId) || 0) +
          (candidate.isFavorite ? 8 : 0) +
          Math.log1p(candidate.playCount),
      );
    }
    const topArtists = [...libraryArtistWeights.entries()]
      .filter(([, weight]) => weight > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_ARTIST_MIXES);
    const candidateByArtist = new Map<string, DiscoveryCandidate>();
    for (const candidate of candidates) {
      if (candidate.artistId && !candidateByArtist.has(candidate.artistId))
        candidateByArtist.set(candidate.artistId, candidate);
    }
    const recentPlans = topArtists.flatMap(([artistId], index): MixPlan[] => {
      const artist = candidateByArtist.get(artistId);
      if (!artist?.artistName) return [];
      const seedGenres = new Set(
        candidates.filter((candidate) => candidate.artistId === artistId).flatMap(candidateGenres),
      );
      const pool = candidates.filter(
        (candidate) =>
          candidate.artistId === artistId ||
          candidateGenres(candidate).some((genre) => seedGenres.has(genre)),
      );
      if (!pool.length) return [];
      const selected = select(
        pool,
        `artist:${artistId}`,
        DISCOVERY_LIMITS.personalized,
        (candidate) =>
          preferenceScore(candidate) +
          (candidate.artistId === artistId ? 20 : 0) +
          candidateGenres(candidate).filter((genre) => seedGenres.has(genre)).length * 5,
      );
      return [
        {
          id: `recent-${artistId}`,
          type: 'recent',
          title: `${artist.artistName} Mix`,
          subtitle: 'Son dinlediklerinden hazırlandı',
          selected,
          candidateCount: pool.length,
          accentIndex: index + 1,
          presentation: {
            titleKey: 'music.discovery.artistMix.title',
            titleArguments: [artist.artistName],
            subtitleKey: 'music.discovery.artistMix.subtitle',
          },
        },
      ];
    });

    const moodPlans = moodRules.flatMap((rule, index): MixPlan[] => {
      const pool = candidates.filter((candidate) =>
        candidateGenres(candidate).some((genre) =>
          rule.genres.some((ruleGenre) => genre.includes(normalizeGenre(ruleGenre))),
        ),
      );
      if (pool.length < MIN_MOOD_TRACKS || artistDiversity(pool, candidateArtistKey) < 3) return [];
      const selected = select(pool, `mood:${rule.id}`, DISCOVERY_LIMITS.collection);
      return [
        {
          id: `mood-${rule.id}`,
          type: 'mood',
          title: rule.title,
          subtitle: `${pool.length} parçadan ${selected.length} şarkılık ruh hali seçkisi`,
          selected,
          candidateCount: pool.length,
          accentIndex: index + 2,
          presentation: {
            titleKey: `music.discovery.mood.${rule.id}.title`,
            subtitleKey: 'music.discovery.selection.mood.subtitle',
            subtitleArguments: [selected.length],
          },
        },
      ];
    });

    const genreCounts = new Map<string, { label: string; candidates: DiscoveryCandidate[] }>();
    for (const candidate of candidates) {
      const rawLabels = [...candidate.genres, ...candidate.albumGenres];
      const counted = new Set<string>();
      for (const label of rawLabels) {
        const key = normalizeGenre(label);
        if (!key || !counted.add(key)) continue;
        const current = genreCounts.get(key) || { label: label.trim(), candidates: [] };
        current.candidates.push(candidate);
        genreCounts.set(key, current);
      }
    }
    const rankedGenres = [...genreCounts.entries()]
      .filter(
        ([genre, value]) =>
          isUsefulGenre(genre) &&
          value.candidates.length >= MIN_COLLECTION_TRACKS &&
          artistDiversity(value.candidates, candidateArtistKey) >= 3,
      )
      .sort(
        (left, right) =>
          right[1].candidates.length - left[1].candidates.length || left[0].localeCompare(right[0]),
      );
    const selectedGenres: typeof rankedGenres = [];
    for (const entry of rankedGenres) {
      const [genre] = entry;
      if (selectedGenres.some(([selected]) => selected.includes(genre) || genre.includes(selected)))
        continue;
      selectedGenres.push(entry);
      if (selectedGenres.length >= MAX_GENRE_COLLECTIONS) break;
    }
    const genrePlans = selectedGenres.map(([genre, value], index): MixPlan => {
      const selected = select(value.candidates, `genre:${genre}`, DISCOVERY_LIMITS.collection);
      return {
        id: `genre-${genre.replace(/\s+/g, '-')}`,
        type: 'genre',
        title: value.label,
        subtitle: `${value.candidates.length} parçadan ${selected.length} şarkılık seçki`,
        selected,
        candidateCount: value.candidates.length,
        accentIndex: index + 1,
        presentation: {
          subtitleKey: 'music.discovery.selection.genre.subtitle',
          subtitleArguments: [selected.length],
        },
      };
    });

    const decadeGroups = new Map<number, DiscoveryCandidate[]>();
    for (const candidate of candidates) {
      const year = candidate.year || candidate.albumYear;
      if (!year || year < 1900) continue;
      const decade = Math.floor(year / 10) * 10;
      const group = decadeGroups.get(decade) || [];
      group.push(candidate);
      decadeGroups.set(decade, group);
    }
    const decadePlans = [...decadeGroups.entries()]
      .filter(([, pool]) => pool.length >= MIN_COLLECTION_TRACKS)
      .sort((left, right) => right[0] - left[0])
      .slice(0, MAX_DECADE_COLLECTIONS)
      .map(([decade, pool], index): MixPlan => {
        const selected = select(pool, `decade:${decade}`, DISCOVERY_LIMITS.collection);
        return {
          id: `decade-${decade}`,
          type: 'decade',
          title: decadeTitle(decade),
          subtitle: `${pool.length} parçadan ${selected.length} şarkılık dönem seçkisi`,
          selected,
          candidateCount: pool.length,
          accentIndex: index + 3,
          presentation: {
            titleKey: 'music.discovery.decade.title',
            titleArguments: [decade],
            subtitleKey: 'music.discovery.selection.decade.subtitle',
            subtitleArguments: [selected.length],
          },
        };
      });

    const primaryPlans = [dailyPlan, rediscoveryPlan, favoritesPlan, ...recentPlans].filter(
      (plan): plan is MixPlan => !!plan && plan.selected.length > 0,
    );
    const collectionPlans = [...moodPlans, ...genrePlans, ...decadePlans];
    if (!collectionPlans.length && candidates.length) {
      const selected = select(candidates, 'library', DISCOVERY_LIMITS.fallback);
      moodPlans.push({
        id: `collection-library-${dateKey()}`,
        type: 'collection',
        title: 'Kütüphaneden Seçmeler',
        subtitle: `${candidates.length} parçadan ${selected.length} şarkılık seçki`,
        selected,
        candidateCount: candidates.length,
        accentIndex: 5,
        presentation: {
          titleKey: 'music.discovery.collection.title',
          subtitleKey: 'music.discovery.collection.subtitle',
        },
      });
    }

    const meaningfulAlbumHistory = new Map<string, Set<string>>();
    for (const entry of meaningfulHistory) {
      if (!entry.track.albumId) continue;
      const tracks = meaningfulAlbumHistory.get(entry.track.albumId) || new Set<string>();
      tracks.add(entry.trackId);
      meaningfulAlbumHistory.set(entry.track.albumId, tracks);
    }
    const candidatesByAlbum = new Map<string, DiscoveryCandidate[]>();
    for (const candidate of candidates) {
      if (!candidate.albumId) continue;
      const albumTracks = candidatesByAlbum.get(candidate.albumId) || [];
      albumTracks.push(candidate);
      candidatesByAlbum.set(candidate.albumId, albumTracks);
    }
    const unfinishedAlbumCandidates = [...candidatesByAlbum.entries()]
      .map(([albumId, albumTracks]) => ({
        albumId,
        albumTracks,
        progress: (meaningfulAlbumHistory.get(albumId)?.size || 0) / albumTracks.length,
      }))
      .filter((album) => album.progress > 0 && album.progress < 0.9)
      .sort((left, right) => right.progress - left.progress)
      .slice(0, 6);

    const allPlans = [...primaryPlans, ...moodPlans, ...genrePlans, ...decadePlans];
    const selectedIds = allPlans.flatMap((plan) => plan.selected.map((candidate) => candidate.id));
    selectedIds.push(
      ...unfinishedAlbumCandidates.flatMap((album) =>
        album.albumTracks.map((candidate) => candidate.id),
      ),
    );
    if (playbackState?.currentTrackId) selectedIds.push(playbackState.currentTrackId);

    const hydrated = await findMusicTracksByIdsWithRelations(this.prisma, userId, selectedIds, {
      library: accessibleLibraryFilter(userId),
    });
    const tracksById = new Map(hydrated.map(formatMusicTrack).map((track) => [track.id, track]));

    const unfinishedAlbums = unfinishedAlbumCandidates.flatMap((album) => {
      const tracks = album.albumTracks
        .sort(
          (left, right) =>
            left.discNumber - right.discNumber || left.trackNumber - right.trackNumber,
        )
        .flatMap((candidate) => {
          const track = tracksById.get(candidate.id);
          return track ? [track] : [];
        });
      const details = tracks[0]?.album;
      return details ? [{ ...details, progress: album.progress, tracks }] : [];
    });

    const currentTrack = playbackState?.currentTrackId
      ? tracksById.get(playbackState.currentTrackId)
      : undefined;
    const continueListening =
      currentTrack &&
      playbackState!.positionSeconds > 10 &&
      (!currentTrack.duration || playbackState!.positionSeconds < currentTrack.duration * 0.92)
        ? { track: currentTrack, positionSeconds: playbackState!.positionSeconds }
        : null;

    const artistTrackCounts = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.artistId)
        artistTrackCounts.set(
          candidate.artistId,
          (artistTrackCounts.get(candidate.artistId) || 0) + 1,
        );
    }
    const radioArtists: MusicArtistDto[] = [...candidateByArtist.entries()]
      .sort(
        ([leftId], [rightId]) =>
          (libraryArtistWeights.get(rightId) || 0) - (libraryArtistWeights.get(leftId) || 0) ||
          leftId.localeCompare(rightId),
      )
      .slice(0, 18)
      .map(([artistId, candidate]) => ({
        id: artistId,
        name: candidate.artistName || 'Sanatçı',
        artworkUrl: candidate.artistArtworkUrl,
        trackCount: artistTrackCounts.get(artistId),
      }));

    return {
      generationId,
      generatedAt: new Date().toISOString(),
      mixes: primaryPlans.map((plan) => materializeMix(plan, tracksById)),
      moodCollections: moodPlans.map((plan) => materializeMix(plan, tracksById)),
      genreCollections: genrePlans.map((plan) => materializeMix(plan, tracksById)),
      decadeCollections: decadePlans.map((plan) => materializeMix(plan, tracksById)),
      continueListening,
      unfinishedAlbums,
      radioArtists,
    };
  }

  private async buildCandidateRadio(
    userId: string,
    candidates: DiscoveryCandidate[],
    seedId: string,
    seedTitle: string,
    seedCandidates: DiscoveryCandidate[],
    artistId?: string,
  ): Promise<MusicMixDto> {
    const history = await this.prisma.musicHistory.findMany({
      where: { userId },
      select: { trackId: true },
      orderBy: { playedAt: 'desc' },
      take: 600,
    });
    const seedGenres = new Set(seedCandidates.flatMap(candidateGenres));
    const seedYears = seedCandidates
      .map((candidate) => candidate.year || candidate.albumYear)
      .filter((year): year is number => !!year);
    const centerYear = seedYears.length
      ? seedYears.reduce((total, year) => total + year, 0) / seedYears.length
      : null;
    const seedIds = new Set(seedCandidates.map((candidate) => candidate.id));
    const related = candidates.filter((candidate) => {
      if (seedIds.has(candidate.id) || (artistId && candidate.artistId === artistId)) return true;
      if (candidateGenres(candidate).some((genre) => seedGenres.has(genre))) return true;
      const year = candidate.year || candidate.albumYear;
      return centerYear !== null && !!year && Math.abs(year - centerYear) <= 6;
    });
    const pool = related.length >= Math.min(30, candidates.length) ? related : candidates;
    const recentIndex = new Map(history.map((entry, index) => [entry.trackId, index]));
    const selected = selectDiscoveryCandidates(
      pool.map((candidate) => {
        const overlap = candidateGenres(candidate).filter((genre) => seedGenres.has(genre)).length;
        const year = candidate.year || candidate.albumYear;
        const yearAffinity =
          centerYear !== null && year ? Math.max(0, 8 - Math.abs(year - centerYear) * 0.7) : 0;
        const historyIndex = recentIndex.get(candidate.id);
        const recentPenalty =
          historyIndex === undefined ? 0 : Math.max(0, 24 - Math.log1p(historyIndex) * 3.5);
        const relevance =
          (artistId && candidate.artistId === artistId ? 22 : 0) +
          overlap * 9 +
          yearAffinity +
          (candidate.isFavorite ? 5 : 0) -
          recentPenalty;
        return {
          value: candidate,
          id: candidate.id,
          artistKey: candidateArtistKey(candidate),
          albumKey: candidateAlbumKey(candidate),
          relevance,
          exploration: relevance - Math.log1p(candidate.playCount) * 3,
        };
      }),
      `radio:${dateKey()}:${seedId}`,
      Math.min(DISCOVERY_LIMITS.radio, pool.length),
    );
    const rawTracks = await findMusicTracksByIdsWithRelations(
      this.prisma,
      userId,
      selected.map((candidate) => candidate.id),
      { library: accessibleLibraryFilter(userId) },
    );
    return mix(
      `radio-${seedId}`,
      'artist-radio',
      `${seedTitle} Radyosu`,
      'Benzer türler, dönemler ve farklı sanatçılardan aralıksız akış',
      rawTracks.map(formatMusicTrack),
      4,
      pool.length,
      undefined,
      {
        titleKey: 'music.discovery.radio.title',
        titleArguments: [seedTitle],
        subtitleKey: 'music.discovery.radio.subtitle',
      },
    );
  }

  public async getArtistRadio(userId: string, artistId: string) {
    const [candidates, artist] = await Promise.all([
      loadDiscoveryCandidates(this.prisma, userId),
      this.prisma.musicArtist.findFirst({
        where: {
          id: artistId,
          OR: [
            { trackCredits: { some: { track: { library: accessibleLibraryFilter(userId) } } } },
            { albumTracks: { some: { library: accessibleLibraryFilter(userId) } } },
          ],
        },
        select: { name: true },
      }),
    ]);
    const seed = candidates.filter((candidate) => candidate.artistId === artistId);
    return this.buildCandidateRadio(
      userId,
      candidates,
      `artist-${artistId}`,
      artist?.name || seed[0]?.artistName || 'Sanatçı',
      seed,
      artistId,
    );
  }

  public async getTrackRadio(userId: string, trackId: string) {
    const candidates = await loadDiscoveryCandidates(this.prisma, userId);
    const seed = candidates.find((candidate) => candidate.id === trackId);
    if (!seed) return null;
    return this.buildCandidateRadio(
      userId,
      candidates,
      `track-${trackId}`,
      seed.title,
      [seed],
      seed.artistId || undefined,
    );
  }
}

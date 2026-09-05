import type { PrismaClient } from '@cinedrive/prisma';
import { accessibleLibraryFilter } from '../utils/library-access.js';
import type { MusicDiscoveryDto, MusicMixDto, MusicTrackDto } from '@cinedrive/shared';
import {
  formatMusicArtist,
  formatMusicTrack,
  findMusicTracksWithRelations,
  parseGenres,
} from '../utils/music-format.js';

const accents = ['violet', 'cyan', 'amber', 'rose', 'emerald', 'indigo'];

const stableNumber = (value: string) => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

const dateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const uniqueTracks = (tracks: MusicTrackDto[], limit = 30) => {
  const seen = new Set<string>();
  return tracks.filter((track) => !seen.has(track.id) && seen.add(track.id)).slice(0, limit);
};

const normalizeGenre = (value: string) =>
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

const trackArtistKey = (track: MusicTrackDto) =>
  track.primaryArtist?.id || track.artists[0]?.id || `unknown:${track.id}`;

const trackAlbumKey = (track: MusicTrackDto) => track.album?.id || `single:${track.id}`;

const artistDiversity = (tracks: MusicTrackDto[]) => new Set(tracks.map(trackArtistKey)).size;

const cappedDiversityCapacity = (
  tracks: MusicTrackDto[],
  key: (track: MusicTrackDto) => string,
  cap: number,
) => {
  const counts = new Map<string, number>();
  tracks.forEach((track) => counts.set(key(track), (counts.get(key(track)) || 0) + 1));
  return [...counts.values()].reduce((total, count) => total + Math.min(cap, count), 0);
};

export const diversifyTracks = (
  tracks: MusicTrackDto[],
  score: (track: MusicTrackDto) => number,
  seed: string,
  limit = 30,
  artistLimit = 4,
  albumLimit = 2,
  relaxCaps = true,
) => {
  const ranked = uniqueTracks(tracks, tracks.length)
    .map((track) => ({
      track,
      score: score(track) + (stableNumber(`${seed}:${track.id}`) % 1000) / 1000,
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
): MusicMixDto => ({
  id,
  type,
  title,
  subtitle,
  description,
  accent: accents[accentIndex % accents.length]!,
  artworkUrls: artworkUrls(tracks),
  tracks: uniqueTracks(tracks, type === 'artist-radio' ? 60 : 30),
  ...presentation,
});

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
    60,
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
    undefined,
    {
      titleKey: 'music.discovery.radio.title',
      titleArguments: [seed.title],
      subtitleKey: 'music.discovery.radio.subtitle',
    },
  );
};

export class MusicDiscoveryService {
  private readonly discoveryCache = new Map<
    string,
    { expiresAt: number; value: MusicDiscoveryDto }
  >();
  private readonly discoveryInflight = new Map<string, Promise<MusicDiscoveryDto>>();

  constructor(private readonly prisma: PrismaClient) {}

  public async getDiscovery(userId: string): Promise<MusicDiscoveryDto> {
    const cached = this.discoveryCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const inflight = this.discoveryInflight.get(userId);
    if (inflight) return inflight;

    const task = this.computeDiscovery(userId);
    this.discoveryInflight.set(userId, task);
    try {
      const value = await task;
      this.discoveryCache.set(userId, { expiresAt: Date.now() + 90_000, value });
      return value;
    } finally {
      this.discoveryInflight.delete(userId);
    }
  }

  private async computeDiscovery(userId: string): Promise<MusicDiscoveryDto> {
    const owned = { library: accessibleLibraryFilter(userId) };
    const [rawTracks, history, playbackState, albums, artists] = await Promise.all([
      findMusicTracksWithRelations(this.prisma, userId, {
        where: owned,
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
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
        take: 1000,
      }),
      this.prisma.musicPlaybackState.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.musicAlbum.findMany({
        where: { tracks: { some: owned } },
        include: {
          artwork: { select: { id: true } },
          artist: true,
          _count: { select: { tracks: { where: owned } } },
        },
        take: 1000,
      }),
      this.prisma.musicArtist.findMany({
        where: { trackCredits: { some: { track: owned } } },
        include: {
          _count: {
            select: {
              albums: { where: { tracks: { some: owned } } },
              trackCredits: { where: { track: owned } },
            },
          },
          artwork: { select: { id: true } },
        },
        take: 1000,
      }),
    ]);
    const tracks = rawTracks.map(formatMusicTrack);
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const isMeaningfulListen = (entry: (typeof history)[number]) => {
      const threshold = entry.track.duration ? Math.min(30, entry.track.duration * 0.45) : 15;
      return entry.listenedSeconds >= threshold;
    };
    // A quick skip is not a completed listen: keep that track eligible for
    // rediscovery instead of teaching the recommendation model to hide it.
    const listenedIds = new Set(history.filter(isMeaningfulListen).map((entry) => entry.trackId));
    const recentlyListenedIds = new Set(
      history
        .filter(isMeaningfulListen)
        .slice(0, 80)
        .map((entry) => entry.trackId),
    );
    const artistWeights = new Map<string, number>();
    const genreWeights = new Map<string, number>();
    history.forEach((entry, index) => {
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

    const preferenceScore = (track: MusicTrackDto) => {
      const artistAffinity = track.primaryArtist?.id
        ? Math.log1p(artistWeights.get(track.primaryArtist.id) || 0) * 5
        : 0;
      const genreAffinity = trackGenres(track).reduce(
        (total, genre) => total + Math.log1p(genreWeights.get(genre) || 0) * 2.5,
        0,
      );
      return artistAffinity + genreAffinity + (track.isFavorite ? 12 : 0);
    };

    const dayKey = dateKey();
    const unheard = tracks.filter((track) => !listenedIds.has(track.id));
    const dailyPool = unheard.length >= Math.min(12, tracks.length) ? unheard : tracks;
    const daily = diversifyTracks(
      dailyPool,
      (track) =>
        preferenceScore(track) +
        (listenedIds.has(track.id) ? -18 : 24) -
        Math.log1p(track.playCount || 0) * 3,
      `daily:${dayKey}:${userId}`,
      30,
    );

    const libraryArtistWeights = new Map(artistWeights);
    for (const track of tracks) {
      if (!track.primaryArtist?.id) continue;
      libraryArtistWeights.set(
        track.primaryArtist.id,
        (libraryArtistWeights.get(track.primaryArtist.id) || 0) +
          (track.isFavorite ? 8 : 0) +
          Math.log1p(track.playCount || 0),
      );
    }
    const topArtists = [...libraryArtistWeights.entries()]
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const recentMixes = topArtists
      .map(([artistId], index) => {
        const artist = artists.find((item) => item.id === artistId);
        if (!artist) return null;
        const seedGenres = new Set(
          tracks.filter((track) => track.primaryArtist?.id === artistId).flatMap(trackGenres),
        );
        const candidates = tracks.filter(
          (track) =>
            track.primaryArtist?.id === artistId ||
            trackGenres(track).some((genre) => seedGenres.has(genre)),
        );
        const selected = diversifyTracks(
          candidates,
          (track) =>
            preferenceScore(track) +
            (track.primaryArtist?.id === artistId ? 24 : 0) +
            trackGenres(track).filter((genre) => seedGenres.has(genre)).length * 5 -
            Math.log1p(track.playCount || 0),
          `artist:${dayKey}:${artistId}`,
          30,
          4,
          2,
        );
        return mix(
          `recent-${artistId}`,
          'recent',
          `${artist.name} Mix`,
          'Son dinlediklerinden hazırlandı',
          selected,
          index + 1,
          undefined,
          {
            titleKey: 'music.discovery.artistMix.title',
            titleArguments: [artist.name],
            subtitleKey: 'music.discovery.artistMix.subtitle',
          },
        );
      })
      .filter((item): item is MusicMixDto => !!item && item.tracks.length > 0);

    const moodCollections = moodRules
      .map((rule, index) => {
        const candidates = tracks.filter((track) =>
          trackGenres(track).some((genre) =>
            rule.genres.some((candidate) => genre.includes(normalizeGenre(candidate))),
          ),
        );
        const diversity = artistDiversity(candidates);
        const selected = diversifyTracks(
          candidates,
          (track) => preferenceScore(track) - Math.log1p(track.playCount || 0),
          `mood:${dayKey}:${rule.id}`,
          Math.min(24, diversity * 4),
        );
        return mix(
          `mood-${rule.id}`,
          'mood',
          rule.title,
          `${selected.length} parçalık ruh hali seçkisi`,
          selected,
          index + 2,
          undefined,
          {
            titleKey: `music.discovery.mood.${rule.id}.title`,
            subtitleKey: 'music.discovery.selection.mood.subtitle',
            subtitleArguments: [selected.length],
          },
        );
      })
      .filter((item) => item.tracks.length >= 8 && artistDiversity(item.tracks) >= 3);

    const genreCounts = new Map<string, { label: string; count: number }>();
    const genreArtists = new Map<string, Set<string>>();
    for (const track of tracks) {
      const labels = [...track.genres, ...(track.album?.genres || [])];
      const countedGenres = new Set<string>();
      for (const label of labels) {
        const key = normalizeGenre(label);
        if (!key || !countedGenres.add(key)) continue;
        const current = genreCounts.get(key);
        genreCounts.set(key, {
          label: current?.label || label.trim(),
          count: (current?.count || 0) + 1,
        });
        const artistKey = trackArtistKey(track);
        const artistIDs = genreArtists.get(key) || new Set<string>();
        artistIDs.add(artistKey);
        genreArtists.set(key, artistIDs);
      }
    }
    const rankedGenres = [...genreCounts.entries()]
      .filter(([, value]) => value.count >= 4)
      .filter(([genre]) => isUsefulGenre(genre))
      .filter(([genre]) => (genreArtists.get(genre)?.size || 0) >= 3)
      .sort((left, right) => right[1].count - left[1].count);
    const selectedGenres: typeof rankedGenres = [];
    for (const entry of rankedGenres) {
      const [genre] = entry;
      if (selectedGenres.some(([selected]) => selected.includes(genre) || genre.includes(selected)))
        continue;
      selectedGenres.push(entry);
      if (selectedGenres.length >= 10) break;
    }
    const genreCollections = selectedGenres.map(([genre, value], index) => {
      const candidates = tracks.filter((track) => trackGenres(track).includes(genre));
      const selected = diversifyTracks(
        candidates,
        (track) => preferenceScore(track) - Math.log1p(track.playCount || 0),
        `genre:${dayKey}:${genre}`,
        Math.min(24, artistDiversity(candidates) * 4),
      );
      return mix(
        `genre-${genre.replace(/\s+/g, '-')}`,
        'genre',
        value.label,
        `${value.count} parçalık tür seçkisi`,
        selected,
        index + 1,
        undefined,
        {
          subtitleKey: 'music.discovery.selection.genre.subtitle',
          subtitleArguments: [value.count],
        },
      );
    });

    const decadeGroups = new Map<number, MusicTrackDto[]>();
    for (const track of tracks) {
      const year = track.year || track.album?.year;
      if (!year || year < 1900) continue;
      const decade = Math.floor(year / 10) * 10;
      decadeGroups.set(decade, [...(decadeGroups.get(decade) || []), track]);
    }
    const decadeCollections = [...decadeGroups.entries()]
      .filter(([, items]) => items.length >= 4)
      .sort((left, right) => right[0] - left[0])
      .slice(0, 8)
      .map(([decade, items], index) =>
        mix(
          `decade-${decade}`,
          'decade',
          decadeTitle(decade),
          `${items.length} parçalık dönem seçkisi`,
          diversifyTracks(
            items,
            (track) => preferenceScore(track) - Math.log1p(track.playCount || 0),
            `decade:${dayKey}:${decade}`,
            24,
          ),
          index + 3,
          undefined,
          {
            titleKey: 'music.discovery.decade.title',
            titleArguments: [decade],
            subtitleKey: 'music.discovery.selection.decade.subtitle',
            subtitleArguments: [items.length],
          },
        ),
      );

    const favoriteTracks = tracks.filter((track) => track.isFavorite);
    const rediscovery = diversifyTracks(
      tracks.filter((track) => !recentlyListenedIds.has(track.id)),
      (track) =>
        (track.isFavorite ? 10 : 0) +
        Math.log1p(track.playCount || 0) * 5 -
        (recentlyListenedIds.has(track.id) ? 30 : 0),
      `rediscovery:${dayKey}:${userId}`,
      30,
    );
    const favoritesMix = diversifyTracks(
      favoriteTracks,
      (track) => preferenceScore(track) - Math.log1p(track.playCount || 0),
      `favorites:${dayKey}:${userId}`,
      30,
    );

    const albumHistory = new Map<string, Set<string>>();
    history.forEach((entry) => {
      if (!entry.track.albumId) return;
      const set = albumHistory.get(entry.track.albumId) || new Set<string>();
      set.add(entry.trackId);
      albumHistory.set(entry.track.albumId, set);
    });
    const tracksByAlbum = new Map<string, MusicTrackDto[]>();
    for (const track of tracks) {
      const albumId = track.album?.id;
      if (!albumId) continue;
      const albumTracks = tracksByAlbum.get(albumId) || [];
      albumTracks.push(track);
      tracksByAlbum.set(albumId, albumTracks);
    }
    const unfinishedAlbums = albums
      .map((album) => {
        const played = albumHistory.get(album.id)?.size || 0;
        const progress = album._count.tracks ? played / album._count.tracks : 0;
        const albumTracks = (tracksByAlbum.get(album.id) || []).sort(
          (a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber,
        );
        return {
          id: album.id,
          title: album.title,
          year: album.year,
          genres: parseGenres(album.genres),
          artist: album.artist,
          artworkUrl: album.artwork ? `/api/music/artwork/${album.artwork.id}` : null,
          trackCount: album._count.tracks,
          releaseType: album.releaseType,
          secondaryTypes: parseGenres(album.secondaryTypes),
          progress,
          tracks: albumTracks,
        };
      })
      .filter((album) => album.progress > 0 && album.progress < 0.9)
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 6);

    const currentTrack = playbackState?.currentTrackId
      ? trackById.get(playbackState.currentTrackId)
      : undefined;
    const continueListening =
      currentTrack &&
      playbackState!.positionSeconds > 10 &&
      (!currentTrack.duration || playbackState!.positionSeconds < currentTrack.duration * 0.92)
        ? { track: currentTrack, positionSeconds: playbackState!.positionSeconds }
        : null;

    const radioArtists = artists
      .sort((a, b) => (libraryArtistWeights.get(b.id) || 0) - (libraryArtistWeights.get(a.id) || 0))
      .slice(0, 18)
      .map(formatMusicArtist);

    const mixes = [
      mix(
        `daily-${dayKey}`,
        'daily',
        'Günlük Keşif',
        'Dinleme alışkanlıkların, az çalınanlar ve kütüphane çeşitliliğiyle hazırlandı',
        daily,
        0,
        undefined,
        {
          titleKey: 'music.discovery.daily.title',
          subtitleKey: 'music.discovery.daily.subtitle',
        },
      ),
      ...(rediscovery.length
        ? [
            mix(
              `rediscovery-${dayKey}`,
              'rediscovery',
              'Yeniden Keşfet',
              'Bir süredir dinlemediğin güçlü seçimler',
              rediscovery,
              4,
              undefined,
              {
                titleKey: 'music.discovery.rediscovery.title',
                subtitleKey: 'music.discovery.rediscovery.subtitle',
              },
            ),
          ]
        : []),
      ...(favoritesMix.length
        ? [
            mix(
              `favorites-${dayKey}`,
              'favorites',
              'Favori Akışı',
              'Favorilerinden çeşitlendirilmiş günlük akış',
              favoritesMix,
              3,
              undefined,
              {
                titleKey: 'music.discovery.favorites.title',
                subtitleKey: 'music.discovery.favorites.subtitle',
              },
            ),
          ]
        : []),
      ...recentMixes,
    ].filter((item) => item.tracks.length > 0);

    if (
      !moodCollections.length &&
      !genreCollections.length &&
      !decadeCollections.length &&
      tracks.length
    )
      moodCollections.push(
        mix(
          `collection-library-${dayKey}`,
          'collection',
          'Kütüphaneden Seçmeler',
          'Az çalınan sanatçı ve albümlerden dengeli bir seçki',
          diversifyTracks(
            tracks,
            (track) => -Math.log1p(track.playCount || 0),
            `library:${dayKey}:${userId}`,
            24,
          ),
          5,
          undefined,
          {
            titleKey: 'music.discovery.collection.title',
            subtitleKey: 'music.discovery.collection.subtitle',
          },
        ),
      );

    return {
      mixes,
      moodCollections,
      genreCollections,
      decadeCollections,
      continueListening,
      unfinishedAlbums,
      radioArtists,
    };
  }

  public async getArtistRadio(userId: string, artistId: string) {
    const [rawTracks, artist, history] = await Promise.all([
      findMusicTracksWithRelations(this.prisma, userId, {
        where: { library: accessibleLibraryFilter(userId) },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.prisma.musicArtist.findFirst({
        where: {
          id: artistId,
          OR: [
            { trackCredits: { some: { track: { library: accessibleLibraryFilter(userId) } } } },
            { albumTracks: { some: { library: accessibleLibraryFilter(userId) } } },
          ],
        },
      }),
      this.prisma.musicHistory.findMany({
        where: { userId },
        select: { trackId: true },
        orderBy: { playedAt: 'desc' },
        take: 600,
      }),
    ]);
    const tracks = rawTracks.map(formatMusicTrack);
    const seed = tracks.filter((track) => track.primaryArtist?.id === artistId);
    return buildRadioMix(
      tracks,
      history.map((entry) => entry.trackId),
      { id: `artist-${artistId}`, title: artist?.name || 'Sanatçı', tracks: seed, artistId },
    );
  }

  public async getTrackRadio(userId: string, trackId: string) {
    const [rawTracks, history] = await Promise.all([
      findMusicTracksWithRelations(this.prisma, userId, {
        where: { library: accessibleLibraryFilter(userId) },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.prisma.musicHistory.findMany({
        where: { userId },
        select: { trackId: true },
        orderBy: { playedAt: 'desc' },
        take: 600,
      }),
    ]);
    const tracks = rawTracks.map(formatMusicTrack);
    const seedTrack = tracks.find((track) => track.id === trackId);
    if (!seedTrack) return null;
    return buildRadioMix(
      tracks,
      history.map((entry) => entry.trackId),
      {
        id: `track-${trackId}`,
        title: seedTrack.title,
        tracks: [seedTrack],
        artistId: seedTrack.primaryArtist?.id,
      },
    );
  }
}

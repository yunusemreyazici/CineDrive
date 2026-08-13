import type { PrismaClient } from '@prisma/client';
import type { MusicMixDto, MusicTrackDto } from '@cinedrive/shared';
import {
  formatMusicArtist,
  formatMusicTrack,
  musicTrackInclude,
  parseGenres,
} from '../utils/music-format.js';

const accents = ['violet', 'cyan', 'amber', 'rose', 'emerald', 'indigo'];

const stableNumber = (value: string) => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

const uniqueTracks = (tracks: MusicTrackDto[], limit = 30) => {
  const seen = new Set<string>();
  return tracks.filter((track) => !seen.has(track.id) && seen.add(track.id)).slice(0, limit);
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
): MusicMixDto => ({
  id,
  type,
  title,
  subtitle,
  description,
  accent: accents[accentIndex % accents.length]!,
  artworkUrls: artworkUrls(tracks),
  tracks: uniqueTracks(tracks),
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

export class MusicDiscoveryService {
  constructor(private readonly prisma: PrismaClient) {}

  public async getDiscovery(userId: string) {
    const owned = { library: { userId } };
    const [rawTracks, history, playbackState, albums, artists] = await Promise.all([
      this.prisma.musicTrack.findMany({
        where: owned,
        include: musicTrackInclude(userId),
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.musicHistory.findMany({
        where: { userId },
        select: {
          trackId: true,
          playedAt: true,
          listenedSeconds: true,
          track: { select: { albumId: true, primaryArtistId: true, genres: true } },
        },
        orderBy: { playedAt: 'desc' },
        take: 500,
      }),
      this.prisma.musicPlaybackState.findUnique({ where: { userId } }),
      this.prisma.musicAlbum.findMany({
        where: { userId, tracks: { some: owned } },
        include: {
          artwork: { select: { id: true } },
          artist: true,
          _count: { select: { tracks: true } },
        },
        take: 200,
      }),
      this.prisma.musicArtist.findMany({
        where: { userId, trackCredits: { some: { track: owned } } },
        include: {
          _count: { select: { albums: true, trackCredits: true } },
          artwork: { select: { id: true } },
        },
        take: 100,
      }),
    ]);
    const tracks = rawTracks.map(formatMusicTrack);
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const listenedIds = new Set(history.map((entry) => entry.trackId));
    const artistWeights = new Map<string, number>();
    const genreWeights = new Map<string, number>();
    history.forEach((entry, index) => {
      const weight = Math.max(1, 30 - index / 8);
      if (entry.track.primaryArtistId)
        artistWeights.set(
          entry.track.primaryArtistId,
          (artistWeights.get(entry.track.primaryArtistId) || 0) + weight,
        );
      parseGenres(entry.track.genres).forEach((genre) =>
        genreWeights.set(
          genre.toLocaleLowerCase(),
          (genreWeights.get(genre.toLocaleLowerCase()) || 0) + weight,
        ),
      );
    });

    const dayKey = new Date().toISOString().slice(0, 10);
    const daily = [...tracks]
      .filter((track) => !listenedIds.has(track.id))
      .sort((left, right) => {
        const score = (track: MusicTrackDto) =>
          (track.primaryArtist?.id ? artistWeights.get(track.primaryArtist.id) || 0 : 0) * 0.35 +
          track.genres.reduce(
            (total, genre) => total + (genreWeights.get(genre.toLocaleLowerCase()) || 0),
            0,
          ) +
          (stableNumber(`${dayKey}:${userId}:${track.id}`) % 1000) / 1000;
        return score(right) - score(left);
      });
    const fallbackDaily = [...tracks].sort(
      (left, right) =>
        (left.playCount || 0) - (right.playCount || 0) ||
        stableNumber(`${dayKey}:${left.id}`) - stableNumber(`${dayKey}:${right.id}`),
    );

    const topArtists = [...artistWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const recentMixes = topArtists
      .map(([artistId], index) => {
        const artist = artists.find((item) => item.id === artistId);
        if (!artist) return null;
        const seedGenres = new Set(
          tracks
            .filter((track) => track.primaryArtist?.id === artistId)
            .flatMap((track) => track.genres.map((genre) => genre.toLocaleLowerCase())),
        );
        const candidates = tracks.filter(
          (track) =>
            track.primaryArtist?.id === artistId ||
            track.genres.some((genre) => seedGenres.has(genre.toLocaleLowerCase())),
        );
        return mix(
          `recent-${artistId}`,
          'recent',
          `${artist.name} Mix`,
          'Son dinlediklerinden hazırlandı',
          candidates,
          index + 1,
        );
      })
      .filter((item): item is MusicMixDto => !!item && item.tracks.length > 0);

    const moodCollections = moodRules
      .map((rule, index) =>
        mix(
          `mood-${rule.id}`,
          'mood',
          rule.title,
          'Ruh haline göre koleksiyon',
          tracks.filter((track) =>
            track.genres.some((genre) =>
              rule.genres.some((candidate) => genre.toLocaleLowerCase().includes(candidate)),
            ),
          ),
          index + 2,
        ),
      )
      .filter((item) => item.tracks.length >= 2);

    const albumHistory = new Map<string, Set<string>>();
    history.forEach((entry) => {
      if (!entry.track.albumId) return;
      const set = albumHistory.get(entry.track.albumId) || new Set<string>();
      set.add(entry.trackId);
      albumHistory.set(entry.track.albumId, set);
    });
    const unfinishedAlbums = albums
      .map((album) => {
        const played = albumHistory.get(album.id)?.size || 0;
        const progress = album._count.tracks ? played / album._count.tracks : 0;
        const albumTracks = tracks
          .filter((track) => track.album?.id === album.id)
          .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
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
      .sort((a, b) => (artistWeights.get(b.id) || 0) - (artistWeights.get(a.id) || 0))
      .slice(0, 8)
      .map(formatMusicArtist);

    return {
      mixes: [
        mix(
          `daily-${dayKey}`,
          'daily',
          'Günlük Keşif',
          'Her gün kütüphanenden yeni seçimler',
          daily.length ? daily : fallbackDaily,
          0,
        ),
        ...recentMixes,
      ].filter((item) => item.tracks.length > 0),
      moodCollections,
      continueListening,
      unfinishedAlbums,
      radioArtists,
    };
  }

  public async getArtistRadio(userId: string, artistId: string) {
    const discovery = await this.getDiscovery(userId);
    const allTracks = [...discovery.mixes, ...discovery.moodCollections].flatMap(
      (item) => item.tracks,
    );
    const seed = allTracks.filter((track) => track.primaryArtist?.id === artistId);
    const genres = new Set(
      seed.flatMap((track) => track.genres.map((genre) => genre.toLocaleLowerCase())),
    );
    const related = allTracks.filter(
      (track) =>
        track.primaryArtist?.id !== artistId &&
        track.genres.some((genre) => genres.has(genre.toLocaleLowerCase())),
    );
    const artist = discovery.radioArtists.find((item) => item.id === artistId);
    return mix(
      `artist-radio-${artistId}`,
      'artist-radio',
      `${artist?.name || 'Sanatçı'} Radyosu`,
      'Benzer parçalardan kesintisiz radyo',
      [...seed, ...related],
      4,
    );
  }
}

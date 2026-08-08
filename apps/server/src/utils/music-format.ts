import type { Prisma } from '@prisma/client';

export const musicTrackInclude = (userId: string) => ({
  album: { include: { artist: true, artwork: { select: { id: true } } } },
  primaryArtist: true,
  artwork: { select: { id: true } },
  artists: { orderBy: { position: 'asc' as const }, include: { artist: true } },
  favorites: { where: { userId }, select: { id: true } },
} satisfies Prisma.MusicTrackInclude);

export type MusicTrackWithRelations = Prisma.MusicTrackGetPayload<{
  include: {
    album: { include: { artist: true; artwork: { select: { id: true } } } };
    primaryArtist: true;
    artwork: { select: { id: true } };
    artists: { include: { artist: true } };
    favorites: { select: { id: true } };
  };
}>;

export const parseGenres = (raw?: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

export const formatMusicTrack = (track: MusicTrackWithRelations) => {
  const artworkId = track.artwork?.id || track.album?.artwork?.id;
  return {
    id: track.id,
    title: track.title,
    discNumber: track.discNumber,
    trackNumber: track.trackNumber,
    year: track.year,
    genres: parseGenres(track.genres),
    duration: track.duration,
    album: track.album ? {
      id: track.album.id,
      title: track.album.title,
      year: track.album.year,
      genres: parseGenres(track.album.genres),
      artist: track.album.artist ? {
        id: track.album.artist.id,
        name: track.album.artist.name,
        sortName: track.album.artist.sortName,
        musicbrainzId: track.album.artist.musicbrainzId,
      } : null,
      artworkUrl: track.album.artwork?.id ? `/api/music/artwork/${track.album.artwork.id}` : null,
    } : null,
    primaryArtist: track.primaryArtist ? {
      id: track.primaryArtist.id,
      name: track.primaryArtist.name,
      sortName: track.primaryArtist.sortName,
      musicbrainzId: track.primaryArtist.musicbrainzId,
    } : null,
    artists: track.artists.map(({ artist }) => ({
      id: artist.id,
      name: artist.name,
      sortName: artist.sortName,
      musicbrainzId: artist.musicbrainzId,
    })),
    artworkUrl: artworkId ? `/api/music/artwork/${artworkId}` : null,
    isFavorite: track.favorites.length > 0,
    streamUrl: `/api/music/tracks/${track.id}/stream`,
    createdAt: track.createdAt.toISOString(),
  };
};

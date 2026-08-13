import type { MusicTrackDto } from '@cinedrive/shared';

export const rankArtistTracks = (tracks: MusicTrackDto[], limit = 5) =>
  [...tracks]
    .sort(
      (left, right) =>
        (right.playCount || 0) - (left.playCount || 0) ||
        Number(right.isFavorite) - Number(left.isFavorite) ||
        (right.year || right.album?.year || 0) - (left.year || left.album?.year || 0) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, limit);

import type { MusicTrackDto } from '@cinedrive/shared';
import { describe, expect, it } from 'vitest';
import { rankArtistTracks } from './artistPopularity';

const track = (id: string, playCount: number, favorite = false): MusicTrackDto => ({
  id,
  title: id,
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: favorite,
  playCount,
  streamUrl: `/api/music/tracks/${id}/stream`,
  createdAt: '2026-08-14T00:00:00.000Z',
});

describe('artist popularity', () => {
  it('ranks local tracks by CineDrive listening count', () => {
    const result = rankArtistTracks([
      track('once', 1),
      track('favorite-tie', 4, true),
      track('regular-tie', 4),
      track('most-played', 12),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      'most-played',
      'favorite-tie',
      'regular-tie',
      'once',
    ]);
  });
});

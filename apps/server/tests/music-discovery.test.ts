import type { MusicTrackDto } from '@cinedrive/shared';
import { describe, expect, it } from 'vitest';
import { buildRadioMix, diversifyTracks } from '../src/services/music-discovery.service';

const track = (index: number): MusicTrackDto => {
  const artist = Math.floor(index / 4);
  return {
    id: `track-${index}`,
    title: `Track ${index}`,
    discNumber: 1,
    trackNumber: index + 1,
    genres: ['Rock'],
    album: {
      id: `album-${artist}-${Math.floor((index % 4) / 2)}`,
      title: `Album ${index}`,
      genres: ['Rock'],
    },
    primaryArtist: { id: `artist-${artist}`, name: `Artist ${artist}` },
    artists: [],
    isFavorite: false,
    playCount: 0,
    streamUrl: `/api/music/tracks/track-${index}/stream`,
    createdAt: '2026-08-14T00:00:00.000Z',
  };
};

describe('music discovery diversification', () => {
  it('prevents one artist or album from taking over a large recommendation set', () => {
    const result = diversifyTracks(
      Array.from({ length: 40 }, (_, index) => track(index)),
      (item) => (item.primaryArtist?.id === 'artist-0' ? 100 : 1),
      'test-day',
      30,
    );
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    for (const item of result) {
      const artistId = item.primaryArtist!.id;
      const albumId = item.album!.id;
      artistCounts.set(artistId, (artistCounts.get(artistId) || 0) + 1);
      albumCounts.set(albumId, (albumCounts.get(albumId) || 0) + 1);
    }
    expect(result).toHaveLength(30);
    expect(artistCounts.size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...artistCounts.values())).toBeLessThanOrEqual(4);
    expect(Math.max(...albumCounts.values())).toBeLessThanOrEqual(2);
  });

  it('builds a broad radio queue instead of repeating the seed artist', () => {
    const tracks = Array.from({ length: 40 }, (_, index) => track(index));
    const result = buildRadioMix(
      tracks,
      tracks.slice(0, 8).map((item) => item.id),
      {
        id: 'artist-0',
        title: 'Artist 0',
        artistId: 'artist-0',
        tracks: tracks.slice(0, 4),
      },
    );
    const artistCounts = new Map<string, number>();
    for (const item of result.tracks) {
      const artistId = item.primaryArtist!.id;
      artistCounts.set(artistId, (artistCounts.get(artistId) || 0) + 1);
    }

    expect(result.tracks).toHaveLength(40);
    expect(artistCounts.size).toBe(10);
    expect(Math.max(...artistCounts.values())).toBeLessThanOrEqual(4);
  });
});

import type { MusicTrackDto } from '@cinedrive/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRadioMix,
  diversifyTracks,
  isMeaningfulDiscoveryListen,
} from '../src/services/music-discovery.service';
import { loadDiscoveryCandidates } from '../src/services/music-discovery-candidates';
import {
  DISCOVERY_LIMITS,
  createDiscoverySelectionContext,
  selectDiscoveryCandidates,
} from '../src/services/music-discovery-selection';

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

  const candidates = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      value: index,
      id: `candidate-${index}`,
      artistKey: `artist-${Math.floor(index / 5)}`,
      albumKey: `album-${Math.floor(index / 2)}`,
      relevance: (index * 17) % 101,
      exploration: ((count - index) * 29) % 103,
    }));

  it('is stable within one generation and changes substantially across generations', () => {
    const pool = candidates(300);
    const first = selectDiscoveryCandidates(pool, 'generation-a', 50);
    const repeated = selectDiscoveryCandidates(pool, 'generation-a', 50);
    const next = selectDiscoveryCandidates(pool, 'generation-b', 50);

    expect(repeated).toEqual(first);
    const overlap = next.filter((value) => first.includes(value)).length / first.length;
    expect(overlap).toBeLessThan(0.5);
  });

  it('returns the collection target and preserves artist and album diversity', () => {
    const pool = candidates(300);
    const result = selectDiscoveryCandidates(pool, 'large-genre', DISCOVERY_LIMITS.collection);
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    for (const value of result) {
      const candidate = pool[value]!;
      artistCounts.set(candidate.artistKey, (artistCounts.get(candidate.artistKey) || 0) + 1);
      albumCounts.set(candidate.albumKey, (albumCounts.get(candidate.albumKey) || 0) + 1);
    }

    expect(result).toHaveLength(50);
    expect(Math.max(...artistCounts.values())).toBeLessThanOrEqual(4);
    expect(Math.max(...albumCounts.values())).toBeLessThanOrEqual(2);
  });

  it('avoids reusing tracks across visible collections when the pool is large enough', () => {
    const pool = candidates(300);
    const context = createDiscoverySelectionContext();
    const daily = selectDiscoveryCandidates(pool, 'daily-generation', 50, context);
    const genre = selectDiscoveryCandidates(pool, 'genre-generation', 50, context);
    const mood = selectDiscoveryCandidates(pool, 'mood-generation', 50, context);
    const all = [...daily, ...genre, ...mood];

    expect(new Set(all).size).toBe(all.length);
  });

  it('paginates through a 10,000-track library and exposes its second half to selection', async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `track-${String(index).padStart(5, '0')}`,
      title: `Track ${index}`,
      discNumber: 1,
      trackNumber: index + 1,
      albumId: `album-${Math.floor(index / 10)}`,
      primaryArtistId: `artist-${Math.floor(index / 5)}`,
      year: 2000 + (index % 25),
      genres: '["Rock"]',
      duration: 180,
      createdAt: new Date(1_600_000_000_000 + index),
      album: { title: `Album ${index}`, year: 2000, genres: '["Rock"]' },
      primaryArtist: { name: `Artist ${index}`, artwork: null },
      favorites: [],
      _count: { history: 0 },
    }));
    const findMany = vi.fn(async (query: { cursor?: { id: string }; take: number }) => {
      const start = query.cursor ? rows.findIndex((row) => row.id === query.cursor!.id) + 1 : 0;
      return rows.slice(start, start + query.take);
    });
    const loaded = await loadDiscoveryCandidates({ musicTrack: { findMany } } as never, 'user-1');
    const selected = selectDiscoveryCandidates(
      loaded.map((candidate) => ({
        value: candidate.id,
        id: candidate.id,
        artistKey: candidate.artistId!,
        albumKey: candidate.albumId!,
        relevance: 1,
        exploration: 1,
      })),
      'all-library',
      50,
    );

    expect(loaded).toHaveLength(10_000);
    expect(findMany).toHaveBeenCalledTimes(26);
    expect(selected.some((id) => Number(id.slice(-5)) >= 5_000)).toBe(true);
  });

  it('keeps quick skips out of meaningful listening signals', () => {
    expect(isMeaningfulDiscoveryListen({ listenedSeconds: 3, track: { duration: 180 } })).toBe(
      false,
    );
    expect(isMeaningfulDiscoveryListen({ listenedSeconds: 30, track: { duration: 180 } })).toBe(
      true,
    );
    expect(isMeaningfulDiscoveryListen({ listenedSeconds: 14, track: { duration: null } })).toBe(
      false,
    );
  });
});

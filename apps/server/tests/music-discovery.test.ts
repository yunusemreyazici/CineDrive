import type { MusicTrackDto } from '@cinedrive/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRadioMix,
  diversifyTracks,
  isMeaningfulDiscoveryListen,
} from '../src/services/music-discovery.service';
import { loadDiscoveryCandidates } from '../src/services/music-discovery-candidates';
import type { DiscoveryCandidate } from '../src/services/music-discovery-candidates';
import {
  buildLibraryDepthPlanDefinitions,
  type DiscoveryHistorySignal,
} from '../src/services/music-discovery-library-depth';
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

const depthCandidate = (
  id: string,
  options: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate => ({
  id,
  title: id,
  discNumber: 1,
  trackNumber: 1,
  artistId: options.artistId ?? `artist-${id}`,
  artistName: options.artistName ?? `Artist ${id}`,
  artistArtworkUrl: null,
  albumId: options.albumId ?? `album-${id}`,
  albumTitle: options.albumTitle ?? `Album ${id}`,
  albumYear: options.albumYear ?? 2000,
  genres: options.genres ?? ['Rock'],
  albumGenres: options.albumGenres ?? [],
  year: options.year ?? 2000,
  duration: options.duration ?? 200,
  playCount: options.playCount ?? 0,
  isFavorite: options.isFavorite ?? false,
  languageCode: null,
  languageSource: null,
  languageConfidence: null,
  createdAt: options.createdAt ?? new Date('2020-01-01T00:00:00.000Z'),
  updatedAt: options.updatedAt ?? new Date('2020-01-01T00:00:00.000Z'),
});

const historySignal = (
  date: string,
  meaningfulPlayCount = 1,
  averageCompletion = 0.8,
): DiscoveryHistorySignal => ({
  meaningfulPlayCount,
  completionTotal: meaningfulPlayCount * averageCompletion,
  lastMeaningfulPlayAt: new Date(date),
});

const buildDepthPlans = (
  candidates: DiscoveryCandidate[],
  historySignals = new Map<string, DiscoveryHistorySignal>(),
  recentIds = new Set<string>(),
) =>
  buildLibraryDepthPlanDefinitions({
    candidates,
    historySignals,
    currentTime: new Date('2026-09-01T00:00:00.000Z').getTime(),
    preferenceScore: (candidate) => (candidate.isFavorite ? 10 : 0),
    explorationScore: (candidate) => 20 - candidate.playCount,
    isRecentlyPlayed: (candidate) => recentIds.has(candidate.id),
  });

describe('music discovery library depth semantics', () => {
  it('uses adaptive inactivity and meaningful listening for long-unplayed candidates', () => {
    const candidates = ['oldest', 'older', 'recent', 'unheard'].map((id) => depthCandidate(id));
    const history = new Map([
      ['oldest', historySignal('2022-01-01')],
      ['older', historySignal('2023-01-01')],
      ['recent', historySignal('2026-08-30')],
    ]);
    const plan = buildDepthPlans(candidates, history, new Set(['recent'])).find(
      (item) => item.id === 'library-depth-long-unplayed',
    );

    expect(plan?.candidates.map((candidate) => candidate.id)).toEqual(['oldest']);
  });

  it('keeps a newly imported zero-play batch from dominating least-played candidates', () => {
    const candidates = [
      depthCandidate('old-zero', { createdAt: new Date('2020-01-01'), playCount: 0 }),
      depthCandidate('old-one', { createdAt: new Date('2021-01-01'), playCount: 1 }),
      depthCandidate('mid', { createdAt: new Date('2022-01-01'), playCount: 2 }),
      depthCandidate('new-zero', { createdAt: new Date('2026-08-31'), playCount: 0 }),
    ];
    const plan = buildDepthPlans(candidates).find(
      (item) => item.id === 'library-depth-least-played',
    );

    expect(plan?.candidates.map((candidate) => candidate.id)).not.toContain('new-zero');
    expect(plan!.relevance(candidates[0]!)).toBeGreaterThan(plan!.relevance(candidates[2]!));
  });

  it('builds hidden favorites from direct behavior instead of cloning explicit favorites', () => {
    const candidates = [
      depthCandidate('behavioral', { isFavorite: false }),
      depthCandidate('explicit-only', { isFavorite: true }),
      depthCandidate('weak', { isFavorite: false }),
      depthCandidate('recent-strong', { isFavorite: true }),
    ];
    const history = new Map([
      ['behavioral', historySignal('2023-01-01', 4, 0.85)],
      ['weak', historySignal('2023-06-01', 1, 0.65)],
      ['recent-strong', historySignal('2026-08-30', 5, 0.95)],
    ]);
    const plan = buildDepthPlans(candidates, history, new Set(['recent-strong'])).find(
      (item) => item.id === 'library-depth-hidden-favorites',
    );

    expect(plan?.candidates.map((candidate) => candidate.id)).toEqual(['behavioral']);
  });

  it('omits history-dependent collections instead of inventing fallback content', () => {
    const plans = buildDepthPlans([depthCandidate('one'), depthCandidate('two')]);

    expect(plans.map((plan) => plan.id)).toEqual(['library-depth-least-played']);
  });

  it('stays deterministic and participates in shared duplicate suppression', () => {
    const candidates = Array.from({ length: 120 }, (_, index) =>
      depthCandidate(`depth-${index}`, {
        artistId: `artist-${Math.floor(index / 4)}`,
        albumId: `album-${Math.floor(index / 2)}`,
        playCount: index % 5,
      }),
    );
    const leastPlayed = buildDepthPlans(candidates).find(
      (plan) => plan.id === 'library-depth-least-played',
    )!;
    const mapped = leastPlayed.candidates.map((candidate) => ({
      value: candidate.id,
      id: candidate.id,
      artistKey: candidate.artistId!,
      albumKey: candidate.albumId!,
      relevance: leastPlayed.relevance(candidate),
      exploration: leastPlayed.relevance(candidate),
    }));
    const context = createDiscoverySelectionContext();
    const daily = selectDiscoveryCandidates(mapped, 'daily', 30, context);
    const depth = selectDiscoveryCandidates(mapped, 'depth', 30, context);
    const repeated = selectDiscoveryCandidates(mapped, 'depth', 30);
    const repeatedAgain = selectDiscoveryCandidates(mapped, 'depth', 30);

    expect(new Set([...daily, ...depth]).size).toBe(60);
    expect(repeatedAgain).toEqual(repeated);
  });
});

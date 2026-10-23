import { describe, it, expect } from 'vitest';
import { playlistRecommendationsSchema } from '@cinedrive/shared';
import {
  recommendPlaylistCandidates,
  recordingKey,
  recommendationReasons,
} from '../src/services/music-playlist-recommendations.service.js';
import { emptyStudio } from '../src/services/music-studio.service.js';
import type { DiscoveryCandidate } from '../src/services/music-discovery-candidates.js';

const candidate = (id: string, values: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate => ({
  id,
  title: `Song ${id}`,
  artistId: `artist-${id}`,
  artistName: `Artist ${id}`,
  artistArtworkUrl: null,
  albumId: `album-${id}`,
  albumTitle: 'Album',
  albumYear: 2005,
  genres: ['rock'],
  albumGenres: [],
  year: 2005,
  duration: 180,
  discNumber: 1,
  trackNumber: 1,
  playCount: 0,
  isFavorite: false,
  languageCode: null,
  languageSource: null,
  languageConfidence: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...values,
});
describe('local playlist recommendations', () => {
  it('explains only confirmed metadata affinities without AI', () => {
    const anchor = candidate('seed');
    expect(
      recommendationReasons(
        candidate('same', { artistId: anchor.artistId, artistName: anchor.artistName }),
        [anchor],
      ),
    ).toEqual([
      { kind: 'genre', value: 'rock' },
      { kind: 'artist', value: anchor.artistName },
      { kind: 'era', value: '2005' },
    ]);
    expect(
      recommendationReasons(candidate('other', { genres: ['jazz'], year: 1980 }), [anchor]),
    ).toEqual([]);
    expect(
      recommendationReasons(
        candidate('missing', { genres: [], albumGenres: [], year: null, albumYear: null }),
        [],
      ),
    ).toEqual([]);
    expect(
      recommendationReasons(
        candidate('album', { genres: [], albumGenres: [' ROCK '], year: null, albumYear: 2007 }),
        [anchor],
      ),
    ).toEqual([
      { kind: 'genre', value: 'rock' },
      { kind: 'era', value: '2007' },
    ]);
  });
  it('prefers matching genres/artists without padding with unrelated favorites', () => {
    const pool = [
      candidate('seed'),
      candidate('rock'),
      candidate('jazz', { genres: ['jazz'], isFavorite: true }),
    ];
    expect(
      recommendPlaylistCandidates(pool, ['seed'], emptyStudio(), 'seed').map((t) => t.id),
    ).toEqual(['rock']);
  });
  it('bounds untrusted input and rejects extra fields', () => {
    expect(
      playlistRecommendationsSchema.safeParse({
        generationId: 'next',
        excludeIds: Array(101).fill('a'),
      }).success,
    ).toBe(false);
    expect(
      playlistRecommendationsSchema.safeParse({ generationId: '', sql: 'SELECT' }).success,
    ).toBe(false);
    expect(playlistRecommendationsSchema.parse({ generationId: 'next' }).excludeIds).toEqual([]);
  });
  it('excludes listed recordings, manual families and metadata variants before diversity relaxation', () => {
    const studio = {
      ...emptyStudio(),
      families: [
        { id: 'family', name: 'Song', trackIds: ['listed', 'manual'], preferredTrackId: 'manual' },
      ],
    };
    const tracks = [
      candidate('listed', { title: 'Hello', artistName: 'Artist', musicbrainzRecordingId: 'mb' }),
      candidate('remaster', { title: 'Hello (2011 Remastered)', artistName: 'Artist' }),
      candidate('mb', { title: 'Different metadata', musicbrainzRecordingId: 'mb' }),
      candidate('manual'),
      candidate('good'),
    ];
    expect(
      recommendPlaylistCandidates(tracks, ['listed'], studio, 'seed').map((t) => t.id),
    ).toEqual(['good']);
  });
  it('collapses variants of suggestions and honors an eligible preferred recording', () => {
    const studio = {
      ...emptyStudio(),
      families: [{ id: 'family', name: 'Song', trackIds: ['a', 'b'], preferredTrackId: 'b' }],
    };
    const result = recommendPlaylistCandidates(
      [candidate('seed'), candidate('a'), candidate('b')],
      ['seed'],
      studio,
      'seed',
    );
    expect(result.map((t) => t.id)).toEqual(['b']);
    expect(
      recommendPlaylistCandidates(
        [candidate('seed'), candidate('a')],
        ['seed'],
        studio,
        'seed',
      ).map((t) => t.id),
    ).toEqual(['a']);
  });
  it('refresh exclusions also exclude all alternate recordings', () => {
    const pool = [
      candidate('seed'),
      candidate('a', { title: 'Hello', artistName: 'Artist' }),
      candidate('b', { title: 'Hello - Live', artistName: 'Artist' }),
      candidate('c'),
    ];
    expect(
      recommendPlaylistCandidates(pool, ['seed'], emptyStudio(), 'next', ['a']).map((t) => t.id),
    ).toEqual(['c']);
  });
  it('is deterministic at 10k, changes generations and preserves diversity', () => {
    const pool = Array.from({ length: 10000 }, (_, i) =>
      candidate(String(i), { artistId: `artist-${i % 50}`, albumId: `album-${i % 100}` }),
    );
    const run = (seed: string, excluded: string[] = []) =>
      recommendPlaylistCandidates(pool, ['0'], emptyStudio(), seed, excluded);
    expect(run('a')).toEqual(run('a'));
    expect(run('a').map((t) => t.id)).not.toEqual(run('b').map((t) => t.id));
    expect(run('a')).toHaveLength(8);
    expect(new Set(run('a').map((t) => t.artistId)).size).toBeGreaterThanOrEqual(4);
    expect(
      run(
        'b',
        run('a').map((t) => t.id),
      ).every((t) => !run('a').some((a) => a.id === t.id)),
    ).toBe(true);
  });
  it('does not hallucinate affinity for empty/inaccessible seed playlists', () => {
    expect(recommendPlaylistCandidates([candidate('a')], [], emptyStudio(), 'seed')).toEqual([]);
    expect(
      recommendPlaylistCandidates([candidate('a')], ['private'], emptyStudio(), 'seed'),
    ).toEqual([]);
  });
  it('retains meaningful title subtitles and does not merge different artists', () => {
    expect(recordingKey(candidate('a', { title: 'Hello (Part 2)' }))).not.toBe(
      recordingKey(candidate('a', { title: 'Hello' })),
    );
    expect(recordingKey(candidate('a', { title: 'Hello' }))).not.toBe(
      recordingKey(candidate('b', { title: 'Hello' })),
    );
  });
});

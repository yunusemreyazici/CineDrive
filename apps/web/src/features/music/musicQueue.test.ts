import { describe, expect, it } from 'vitest';
import type { MusicTrackDto } from '@cinedrive/shared';
import {
  appendMusicQueueEntry,
  insertNextMusicQueueEntry,
  removeMusicQueueEntry,
  shuffleMusicQueueEntries,
  shuffleMusicTracks,
  type MusicQueueEntry,
} from './musicQueue';

const track = (id: string): MusicTrackDto => ({
  id,
  title: id,
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: false,
  streamUrl: `/api/music/tracks/${id}/stream`,
  createdAt: '2026-08-11T00:00:00.000Z',
});

const entry = (id: string, sourceOrder: number, playOrder = sourceOrder): MusicQueueEntry => ({
  id,
  trackId: id,
  sourceOrder,
  playOrder,
  track: track(id),
});

describe('music queue helpers', () => {
  it('keeps source order unique after deleting a middle item and appending', () => {
    const remaining = removeMusicQueueEntry(
      [entry('first', 0), entry('middle', 1), entry('last', 2)],
      'middle',
    );
    const result = appendMusicQueueEntry(remaining, track('new'), 'new');

    expect(result.map((item) => item.sourceOrder)).toEqual([0, 2, 3]);
    expect(new Set(result.map((item) => item.sourceOrder)).size).toBe(result.length);
  });

  it('compacts play order according to the visible queue order', () => {
    const result = removeMusicQueueEntry(
      [entry('source-first', 0, 2), entry('playing-first', 1, 0), entry('middle', 2, 1)],
      'middle',
    );

    expect(result.find((item) => item.id === 'playing-first')?.playOrder).toBe(0);
    expect(result.find((item) => item.id === 'source-first')?.playOrder).toBe(1);
  });

  it('inserts next without reusing a removed source order', () => {
    const result = insertNextMusicQueueEntry(
      [entry('current', 0, 0), entry('later', 2, 1)],
      'current',
      track('next'),
      'next',
    );

    expect(result.find((item) => item.id === 'next')).toMatchObject({
      sourceOrder: 3,
      playOrder: 1,
    });
    expect(result.find((item) => item.id === 'later')?.playOrder).toBe(2);
  });

  it('shuffles a copy without mutating the source list', () => {
    const tracks = [track('one'), track('two'), track('three')];
    const result = shuffleMusicTracks(tracks, () => 0);

    expect(result.map((item) => item.id)).toEqual(['two', 'three', 'one']);
    expect(tracks.map((item) => item.id)).toEqual(['one', 'two', 'three']);
  });

  it('preserves source order while assigning a shuffled play order', () => {
    const result = shuffleMusicQueueEntries(
      [entry('one', 0), entry('two', 1), entry('three', 2)],
      () => 0,
    );

    expect(result.map((item) => item.sourceOrder)).toEqual([0, 1, 2]);
    expect(
      [...result].sort((left, right) => left.playOrder - right.playOrder).map((item) => item.id),
    ).toEqual(['two', 'three', 'one']);
  });
});

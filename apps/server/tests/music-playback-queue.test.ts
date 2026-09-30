import type { PrismaClient } from '@cinedrive/prisma';
import { afterEach, expect, it, vi } from 'vitest';
import { loadPlaybackQueue } from '../src/services/music-playback-queue.service';
import * as musicFormat from '../src/utils/music-format';

afterEach(() => vi.restoreAllMocks());

it('bounds metadata reads for 1000 distinct queue tracks and skips hydration on a hit', async () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    id: `item-${index}`,
    trackId: `track-${index}`,
    sourceOrder: index,
    playOrder: index,
  }));
  const findMany = vi.fn(async (query: { where: { AND: [unknown, { id: { in: string[] } }] } }) =>
    query.where.AND[1].id.in.map((id) => ({ id, updatedAt: new Date('2026-01-01') })),
  );
  const prisma = {
    musicQueueItem: { findMany: vi.fn().mockResolvedValue(entries) },
    musicTrack: { findMany },
  } as unknown as PrismaClient;
  const hydration = vi
    .spyOn(musicFormat, 'findMusicTracksByIdsWithRelations')
    .mockResolvedValue([]);
  const where = { libraryId: 'owned-library' };
  const first = await loadPlaybackQueue(prisma, 'user', 'state', where);
  expect(findMany.mock.calls.map(([query]) => query.where.AND[1].id.in.length)).toEqual([
    400, 400, 200,
  ]);
  expect(findMany.mock.calls.every(([query]) => query.where.AND[0] === where)).toBe(true);
  expect(hydration).toHaveBeenCalledOnce();
  hydration.mockClear();
  const hit = await loadPlaybackQueue(prisma, 'user', 'state', where, first.queueVersion);
  expect(hit.queueUnchanged).toBe(true);
  expect(hydration).not.toHaveBeenCalled();
  const anotherUser = await loadPlaybackQueue(prisma, 'other', 'state', where, first.queueVersion);
  expect(anotherUser.queueUnchanged).toBe(false);
});

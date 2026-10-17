import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { StudioError, readWorkshop } from './music-studio.service.js';

type Item = { id: string; trackId: string };
const compact = (items: Item[]) => items.map(({ id, trackId }) => ({ id, trackId }));

/** Receipts and the write commit together. Serializes same-user admissions on SQLite.
 * Receipt replay must recheck current permissions, but not the obsolete input version.
 */
export async function studioOperation<T>(
  db: PrismaClient,
  userId: string,
  operationId: string | undefined,
  scope: string,
  input: unknown,
  authorize: (tx: Prisma.TransactionClient) => Promise<void>,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "User" SET "id" = "id" WHERE "id" = ${userId}`;
    await authorize(tx);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([scope, input]))
      .digest('hex');
    if (operationId) {
      const existing = await tx.musicStudioOperation.findUnique({
        where: { userId_operationId: { userId, operationId } },
      });
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new StudioError(409, 'Operation ID already used for another request.');
        return JSON.parse(existing.result) as T;
      }
      // Bounded per-user receipts, retained for at least 24 hours. Never evict a
      // recent receipt merely to make room, which would permit duplicate writes.
      await tx.musicStudioOperation.deleteMany({
        where: { userId, createdAt: { lt: new Date(Date.now() - 86400000) } },
      });
      if ((await tx.musicStudioOperation.count({ where: { userId } })) >= 2000)
        throw new StudioError(429, 'Daily operation limit reached.');
    }
    const result = await work(tx);
    if (operationId)
      await tx.musicStudioOperation.create({
        data: {
          userId,
          operationId,
          fingerprint,
          result: JSON.stringify(result),
        },
      });
    return result;
  });
}

export async function authorizeStudioEdit(
  tx: Prisma.TransactionClient,
  userId: string,
  playlistId: string,
) {
  const { role } = await readWorkshop(tx, userId, playlistId);
  if (role === 'listener') throw new StudioError(403, 'Read-only playlist.');
}

export async function notifyStudioChange(
  tx: Prisma.TransactionClient,
  playlistId: string,
  kind: string,
  extraUsers: string[] = [],
) {
  const playlist = await tx.musicPlaylist.findUnique({
    where: { id: playlistId },
    select: { userId: true, memberships: { select: { userId: true } } },
  });
  if (!playlist) return;
  if (kind === 'membership')
    await tx.musicPlaylist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
  const users = [
    ...new Set([playlist.userId, ...playlist.memberships.map((m) => m.userId), ...extraUsers]),
  ];
  for (const userId of users) {
    await tx.musicStudioChange.create({ data: { userId, playlistId, kind } });
    const boundary = await tx.musicStudioChange.findFirst({
      where: { userId },
      orderBy: { id: 'desc' },
      skip: 1999,
      select: { id: true },
    });
    if (boundary)
      await tx.musicStudioChange.deleteMany({ where: { userId, id: { lt: boundary.id } } });
  }
}

export async function recordStudioRevision(
  tx: Prisma.TransactionClient,
  userId: string,
  playlistId: string,
  kind: string,
  before: Item[],
  after: Item[],
) {
  const oldIds = new Set(before.map((i) => `${i.id}:${i.trackId}`));
  const newIds = new Set(after.map((i) => `${i.id}:${i.trackId}`));
  const additions = after.filter((i) => !oldIds.has(`${i.id}:${i.trackId}`)).map((i) => i.id);
  for (let offset = 0; offset < additions.length; offset += 400) {
    await tx.musicPlaylistItem.updateMany({
      where: { playlistId, id: { in: additions.slice(offset, offset + 400) } },
      data: { addedById: userId },
    });
  }
  await tx.musicPlaylistRevision.create({
    data: {
      playlistId,
      actorId: userId,
      kind,
      beforeItems: JSON.stringify(compact(before)),
      afterItems: JSON.stringify(compact(after)),
      addedCount: after.filter((i) => !oldIds.has(`${i.id}:${i.trackId}`)).length,
      removedCount: before.filter((i) => !newIds.has(`${i.id}:${i.trackId}`)).length,
    },
  });
  const boundary = await tx.musicPlaylistRevision.findFirst({
    where: { playlistId },
    orderBy: { id: 'desc' },
    skip: 99,
    select: { id: true },
  });
  if (boundary)
    await tx.musicPlaylistRevision.deleteMany({ where: { playlistId, id: { lt: boundary.id } } });
  await notifyStudioChange(tx, playlistId, kind);
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@cinedrive/prisma';
import type {
  StudioChangesDto,
  StudioHistoryDto,
  StudioPlaylistDirectoryDto,
  StudioRevisionItemsDto,
} from '@cinedrive/shared';
import { readableMusicTrackFilter } from '../utils/library-access.js';
import { playlistWorkshopSchema } from '@cinedrive/shared';
import {
  StudioError,
  playlistAccess,
  readWorkshop,
  requireEditable,
  requireTracks,
  replacePlaylistItems,
} from './music-studio.service.js';
import {
  studioOperation,
  authorizeStudioEdit,
  recordStudioRevision,
  notifyStudioChange,
} from './music-studio-journal.service.js';

export async function createStudioPlaylist(
  db: PrismaClient,
  userId: string,
  input: { operationId: string; name: string },
) {
  return studioOperation(
    db,
    userId,
    input.operationId,
    'create',
    input,
    async () => {},
    async (tx) => {
      const playlist = await tx.musicPlaylist.create({
        data: { id: randomUUID(), userId, name: input.name },
      });
      await notifyStudioChange(tx, playlist.id, 'create');
      return { playlist: { id: playlist.id } };
    },
  );
}

const directoryCursor = z.tuple([z.iso.datetime(), z.string().min(1).max(200)]);
export async function studioDirectory(
  db: PrismaClient,
  userId: string,
  cursor?: string,
  limit = 200,
): Promise<StudioPlaylistDirectoryDto> {
  let after: z.infer<typeof directoryCursor> | undefined;
  if (cursor) {
    try {
      after = directoryCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    } catch {
      throw new StudioError(400, 'Invalid cursor.');
    }
  }
  const rows = await db.musicPlaylist.findMany({
    where: {
      AND: [
        { OR: [playlistAccess(userId), { memberships: { some: { userId } } }] },
        ...(after
          ? [
              {
                OR: [
                  { updatedAt: { lt: new Date(after[0]) } },
                  { updatedAt: new Date(after[0]), id: { lt: after[1] } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      name: true,
      userId: true,
      updatedAt: true,
      memberships: { where: { userId } },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    playlists: page.map((p) => ({
      id: p.id,
      name: p.name,
      role:
        p.userId === userId ? 'owner' : p.memberships[0]?.role === 'editor' ? 'editor' : 'listener',
      pending: p.userId !== userId && !p.memberships[0]?.accepted,
    })),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify([last.updatedAt.toISOString(), last.id])).toString('base64url')
        : null,
  };
}

export async function studioChanges(
  db: PrismaClient,
  userId: string,
  cursor?: number,
): Promise<StudioChangesDto> {
  return db.$transaction(async (tx) => {
    const first = await tx.musicStudioChange.findFirst({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const last = await tx.musicStudioChange.findFirst({
      where: { userId },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    const latest = last?.id ?? 0;
    const resetRequired =
      cursor !== undefined && (cursor > latest || (!!first && cursor < first.id));
    if (cursor === undefined || resetRequired)
      return { cursor: latest, changes: [], hasMore: false, resetRequired };
    const rows = await tx.musicStudioChange.findMany({
      where: { userId, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: 101,
      select: { id: true, playlistId: true, kind: true },
    });
    const page = rows.slice(0, 100);
    // Events carry invalidation IDs only, never track metadata. Revocation remains
    // visible to that recipient so clients can evict cached data after losing access.
    return {
      cursor: page.at(-1)?.id ?? cursor,
      changes: page,
      hasMore: rows.length > 100,
      resetRequired: false,
    };
  });
}

function revisionItems(json: string) {
  return playlistWorkshopSchema.shape.items.parse(JSON.parse(json));
}
export async function studioHistory(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  cursor?: string,
  limit = 50,
): Promise<StudioHistoryDto> {
  const { role } = await readWorkshop(db, userId, playlistId);
  const before = cursor ? z.coerce.number().int().positive().parse(cursor) : undefined;
  const rows = await db.musicPlaylistRevision.findMany({
    where: { playlistId, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      actorId: true,
      kind: true,
      createdAt: true,
      addedCount: true,
      removedCount: true,
    },
  });
  const page = rows.slice(0, limit);
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(page.map((r) => r.actorId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    entries: page.map((row) => {
      return {
        id: row.id,
        actorName: names.get(row.actorId) ?? null,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        added: row.addedCount,
        removed: row.removedCount,
        canRestore: role !== 'listener' && ['edit', 'restore'].includes(row.kind),
      };
    }),
    nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null,
  };
}

/** Load one bounded snapshot only when expanded; never hydrate a whole history page. */
export async function studioRevisionItems(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  revisionId: number,
  cursor?: string,
): Promise<StudioRevisionItemsDto> {
  await readWorkshop(db, userId, playlistId);
  const offset = cursor ? z.coerce.number().int().min(0).max(4000).parse(cursor) : 0;
  const revision = await db.musicPlaylistRevision.findFirst({
    where: { id: revisionId, playlistId },
  });
  if (!revision) throw new StudioError(404, 'Revision not found.');
  const before = revisionItems(revision.beforeItems);
  const after = revisionItems(revision.afterItems);
  const oldIds = new Set(before.map((i) => `${i.id}:${i.trackId}`));
  const newIds = new Set(after.map((i) => `${i.id}:${i.trackId}`));
  const changes = [
    ...after
      .filter((i) => !oldIds.has(`${i.id}:${i.trackId}`))
      .map((i) => ({ ...i, kind: 'added' as const })),
    ...before
      .filter((i) => !newIds.has(`${i.id}:${i.trackId}`))
      .map((i) => ({ ...i, kind: 'removed' as const })),
  ];
  const page = changes.slice(offset, offset + 100);
  const tracks = await db.musicTrack.findMany({
    where: {
      AND: [
        readableMusicTrackFilter(userId),
        { id: { in: page.map((i) => i.trackId) }, driveFile: { status: 'active' } },
      ],
    },
    select: {
      id: true,
      title: true,
      primaryArtist: { select: { name: true } },
      album: { select: { title: true } },
    },
  });
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return {
    items: page.map((i) => ({
      occurrenceId: i.id,
      kind: i.kind,
      track: byId.get(i.trackId) ?? null,
    })),
    nextCursor: offset + 100 < changes.length ? String(offset + 100) : null,
  };
}

export async function restoreStudioRevision(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  revisionId: number,
  input: { operationId: string; version: string },
) {
  return studioOperation(
    db,
    userId,
    input.operationId,
    `restore:${playlistId}:${revisionId}`,
    input,
    (tx) => authorizeStudioEdit(tx, userId, playlistId),
    async (tx) => {
      const { playlist } = await requireEditable(tx, userId, playlistId, input.version);
      const revision = await tx.musicPlaylistRevision.findFirst({
        where: { id: revisionId, playlistId },
      });
      if (!revision || !['edit', 'restore'].includes(revision.kind))
        throw new StudioError(404, 'Restorable revision not found.');
      const items = revisionItems(revision.beforeItems);
      await requireTracks(
        tx,
        userId,
        items.map((i) => i.trackId),
      );
      await requireTracks(
        tx,
        playlist.userId,
        items.map((i) => i.trackId),
      );
      for (let offset = 0; offset < items.length; offset += 400) {
        if (
          await tx.musicPlaylistItem.count({
            where: {
              id: { in: items.slice(offset, offset + 400).map((i) => i.id) },
              playlistId: { not: playlistId },
            },
          })
        )
          throw new StudioError(409, 'Occurrence IDs are no longer available.');
      }
      await replacePlaylistItems(tx, playlistId, items);
      await recordStudioRevision(tx, userId, playlistId, 'restore', playlist.items, items);
      return { version: (await readWorkshop(tx, userId, playlistId)).version };
    },
  );
}

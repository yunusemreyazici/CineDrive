import { randomUUID } from 'node:crypto';
import {
  studioOperation,
  authorizeStudioEdit,
  recordStudioRevision,
  notifyStudioChange,
} from './music-studio-journal.service.js';
import type { PrismaClient } from '@cinedrive/prisma';
import type { z } from 'zod';
import type {
  playlistWorkshopSchema,
  playlistTransferSchema,
  playlistInvitationSchema,
} from '@cinedrive/shared';
import {
  StudioError,
  lockPlaylist,
  readWorkshop,
  requireEditable,
  requireTracks,
  replacePlaylistItems,
} from './music-studio.service.js';

export async function editWorkshopPlaylist(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  value: z.infer<typeof playlistWorkshopSchema>,
) {
  return studioOperation(
    db,
    userId,
    value.operationId,
    `edit:${playlistId}`,
    value,
    (tx) => authorizeStudioEdit(tx, userId, playlistId),
    async (tx) => {
      await lockPlaylist(tx, playlistId);
      const { playlist } = await requireEditable(tx, userId, playlistId, value.version);
      await requireTracks(
        tx,
        userId,
        value.items.map((i) => i.trackId),
      );
      // Collaboration never grants new library access, even to the list owner.
      await requireTracks(
        tx,
        playlist.userId,
        value.items.map((i) => i.trackId),
      );
      for (let offset = 0; offset < value.items.length; offset += 400) {
        const foreign = await tx.musicPlaylistItem.count({
          where: {
            id: { in: value.items.slice(offset, offset + 400).map((i) => i.id) },
            playlistId: { not: playlist.id },
          },
        });
        if (foreign) throw new StudioError(400, 'Invalid occurrence IDs.');
      }
      await replacePlaylistItems(tx, playlist.id, value.items);
      await recordStudioRevision(tx, userId, playlistId, 'edit', playlist.items, value.items);
      return { version: (await readWorkshop(tx, userId, playlist.id)).version };
    },
  );
}

export async function transferWorkshopItems(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  value: z.infer<typeof playlistTransferSchema>,
) {
  if (value.targetId === playlistId) throw new StudioError(400, 'Choose a different playlist.');
  return studioOperation(
    db,
    userId,
    value.operationId,
    `transfer:${playlistId}`,
    value,
    async (tx) => {
      await readWorkshop(tx, userId, playlistId);
      if (value.move) await authorizeStudioEdit(tx, userId, playlistId);
      await authorizeStudioEdit(tx, userId, value.targetId);
    },
    async (tx) => {
      for (const id of [playlistId, value.targetId].sort()) await lockPlaylist(tx, id);
      const source = await readWorkshop(tx, userId, playlistId);
      if (source.version !== value.version) throw new StudioError(409, 'Playlist changed.');
      if (value.move) await requireEditable(tx, userId, playlistId, value.version);
      const target = await requireEditable(tx, userId, value.targetId, value.targetVersion);
      const selected = source.playlist.items.filter((i) => value.itemIds.includes(i.id));
      if (
        selected.length !== value.itemIds.length ||
        target.playlist.items.length + selected.length > 2000
      )
        throw new StudioError(400, 'Invalid selection or playlist too large.');
      await requireTracks(
        tx,
        userId,
        selected.map((i) => i.trackId),
      );
      await requireTracks(
        tx,
        target.playlist.userId,
        selected.map((i) => i.trackId),
      );
      const targetItems = [
        ...target.playlist.items.map(({ id, trackId }) => ({ id, trackId })),
        ...selected.map((i) => ({ id: randomUUID(), trackId: i.trackId })),
      ];
      await replacePlaylistItems(tx, value.targetId, targetItems);
      await recordStudioRevision(
        tx,
        userId,
        value.targetId,
        value.move ? 'move-in' : 'copy',
        target.playlist.items,
        targetItems,
      );
      if (value.move)
        await replacePlaylistItems(
          tx,
          playlistId,
          source.playlist.items
            .filter((i) => !value.itemIds.includes(i.id))
            .map(({ id, trackId }) => ({ id, trackId })),
        );
      if (value.move)
        await recordStudioRevision(
          tx,
          userId,
          playlistId,
          'move-out',
          source.playlist.items,
          source.playlist.items.filter((i) => !value.itemIds.includes(i.id)),
        );
      return { version: (await readWorkshop(tx, userId, playlistId)).version };
    },
  );
}

export async function invitePlaylistMember(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  value: z.infer<typeof playlistInvitationSchema>,
) {
  await db.$transaction(async (tx) => {
    await lockPlaylist(tx, playlistId);
    const { playlist, role } = await readWorkshop(tx, userId, playlistId);
    if (role !== 'owner') throw new StudioError(403, 'Only the owner may invite.');
    if (playlist.memberships.length >= 30) throw new StudioError(422, 'Member limit reached.');
    const user = await tx.user.findFirst({
      where: { email: value.email.trim().toLowerCase(), disabledAt: null },
      select: { id: true },
    });
    if (!user || user.id === userId) throw new StudioError(400, 'Invitation could not be created.');
    // Never silently change an accepted member's permission through a repeated invite.
    const existing = playlist.memberships.find((m) => m.userId === user.id);
    if (existing) throw new StudioError(409, 'Already invited. Revoke before changing the role.');
    await tx.musicPlaylistMembership.create({
      data: { playlistId: playlist.id, userId: user.id, role: value.role },
    });
    await notifyStudioChange(tx, playlistId, 'membership');
  });
}

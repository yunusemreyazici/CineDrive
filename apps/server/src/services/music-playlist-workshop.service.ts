import { randomUUID } from 'node:crypto';
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
  return db.$transaction(async (tx) => {
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
    return { version: (await readWorkshop(tx, userId, playlist.id)).version };
  });
}

export async function transferWorkshopItems(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  value: z.infer<typeof playlistTransferSchema>,
) {
  if (value.targetId === playlistId) throw new StudioError(400, 'Choose a different playlist.');
  return db.$transaction(async (tx) => {
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
    await replacePlaylistItems(tx, value.targetId, [
      ...target.playlist.items.map(({ id, trackId }) => ({ id, trackId })),
      ...selected.map((i) => ({ id: randomUUID(), trackId: i.trackId })),
    ]);
    if (value.move)
      await replacePlaylistItems(
        tx,
        playlistId,
        source.playlist.items
          .filter((i) => !value.itemIds.includes(i.id))
          .map(({ id, trackId }) => ({ id, trackId })),
      );
    return { version: (await readWorkshop(tx, userId, playlistId)).version };
  });
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
  });
}

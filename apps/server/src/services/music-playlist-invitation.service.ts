import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { StudioError, lockPlaylist, readWorkshop } from './music-studio.service.js';
import { notifyStudioChange } from './music-studio-journal.service.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function createPlaylistLink(db: PrismaClient, userId: string, playlistId: string) {
  return db.$transaction(async (tx) => {
    await lockPlaylist(tx, playlistId);
    const { role } = await readWorkshop(tx, userId, playlistId);
    if (role !== 'owner') throw new StudioError(403, 'Only the owner may invite.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await tx.musicPlaylist.update({
      where: { id: playlistId },
      data: { invitationHash: hash(token), invitationExpiresAt: expiresAt },
    });
    await notifyStudioChange(tx, playlistId, 'membership');
    return { token, expiresAt: expiresAt.toISOString() };
  });
}
async function lookup(db: Prisma.TransactionClient, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new StudioError(404, 'Invitation unavailable.');
  const row = await db.musicPlaylist.findFirst({
    where: { invitationHash: hash(token), invitationExpiresAt: { gt: new Date() } },
    include: {
      user: { select: { name: true } },
      memberships: true,
      _count: { select: { items: true } },
    },
  });
  if (!row) throw new StudioError(404, 'Invitation unavailable.');
  return row;
}
export async function previewPlaylistLink(db: PrismaClient, userId: string, token: string) {
  const p = await lookup(db, token);
  // No track names, files, member identities, or library access before acceptance.
  return {
    playlistId: p.id,
    name: p.name,
    ownerName: p.user.name,
    itemCount: p._count.items,
    expiresAt: p.invitationExpiresAt!.toISOString(),
    joined: p.userId === userId || p.memberships.some((m) => m.userId === userId && m.accepted),
  };
}
export async function acceptPlaylistLink(db: PrismaClient, userId: string, token: string) {
  return db.$transaction(async (tx) => {
    const initial = await lookup(tx, token);
    await lockPlaylist(tx, initial.id);
    const p = await lookup(tx, token);
    if (p.userId === userId) return { playlistId: p.id };
    const existing = p.memberships.find((m) => m.userId === userId);
    if (!existing && p.memberships.length >= 30)
      throw new StudioError(422, 'Member limit reached.');
    await tx.musicPlaylistMembership.upsert({
      where: { playlistId_userId: { playlistId: p.id, userId } },
      create: { playlistId: p.id, userId, role: 'editor', accepted: true },
      update: { accepted: true },
    });
    await notifyStudioChange(tx, p.id, 'membership');
    return { playlistId: p.id };
  });
}
export async function revokePlaylistLink(db: PrismaClient, userId: string, playlistId: string) {
  await db.$transaction(async (tx) => {
    await lockPlaylist(tx, playlistId);
    const { role } = await readWorkshop(tx, userId, playlistId);
    if (role !== 'owner') throw new StudioError(403, 'Only the owner may revoke.');
    await tx.musicPlaylist.update({
      where: { id: playlistId },
      data: { invitationHash: null, invitationExpiresAt: null },
    });
    await notifyStudioChange(tx, playlistId, 'membership');
  });
}

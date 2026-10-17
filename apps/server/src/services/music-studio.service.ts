import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { musicStudioSchema, type MusicStudioDto } from '@cinedrive/shared';
import { readableMusicTrackFilter } from '../utils/library-access.js';

export class StudioError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const emptyStudio = (): MusicStudioDto => ({ revision: 0, families: [], sessions: [] });
export async function readStudio(db: PrismaClient, userId: string): Promise<MusicStudioDto> {
  const row = await db.musicStudio.findUnique({ where: { userId } });
  if (!row) return emptyStudio();
  try {
    const parsed = musicStudioSchema.safeParse({
      ...JSON.parse(row.content),
      revision: row.revision,
    });
    return parsed.success ? parsed.data : { ...emptyStudio(), revision: row.revision };
  } catch {
    // A malformed optional preference record must not break basic Discovery.
    return { ...emptyStudio(), revision: row.revision };
  }
}

/** Pick one available version; never substitute a preferred version outside the eligible pool. */
export function selectRecordingVersions<T extends { id: string }>(
  tracks: T[],
  studio: MusicStudioDto,
): T[] {
  const available = new Set(tracks.map((t) => t.id));
  const excluded = new Set<string>();
  for (const family of studio.families) {
    const chosen = available.has(family.preferredTrackId)
      ? family.preferredTrackId
      : family.trackIds.find((id) => available.has(id));
    for (const id of family.trackIds) if (id !== chosen) excluded.add(id);
  }
  return tracks.filter((t) => !excluded.has(t.id));
}

export const playlistAccess = (userId: string): Prisma.MusicPlaylistWhereInput => ({
  OR: [{ userId }, { memberships: { some: { userId, accepted: true } } }],
});
export async function lockPlaylist(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`UPDATE "MusicPlaylist" SET "id" = "id" WHERE "id" = ${id}`;
}
export async function readWorkshop(db: Prisma.TransactionClient, userId: string, id: string) {
  const playlist = await db.musicPlaylist.findFirst({
    where: { id, ...playlistAccess(userId) },
    include: {
      memberships: { include: { user: { select: { name: true } } } },
      items: { orderBy: { position: 'asc' }, take: 2001 },
    },
  });
  if (!playlist) throw new StudioError(404, 'Playlist not found.');
  if (playlist.items.length > 2000)
    throw new StudioError(422, 'Workshop supports up to 2000 entries.');
  const role =
    playlist.userId === userId
      ? 'owner'
      : playlist.memberships.find((m) => m.userId === userId && m.accepted)?.role === 'editor'
        ? 'editor'
        : 'listener';
  const version = createHash('sha256')
    .update(
      JSON.stringify([
        playlist.updatedAt.toISOString(),
        playlist.items.map((i) => [i.id, i.trackId]),
      ]),
    )
    .digest('hex');
  return { playlist, role, version };
}
export async function requireEditable(
  db: Prisma.TransactionClient,
  userId: string,
  id: string,
  version: string,
) {
  const result = await readWorkshop(db, userId, id);
  if (result.role === 'listener') throw new StudioError(403, 'Read-only playlist.');
  if (result.version !== version)
    throw new StudioError(409, 'Playlist changed. Reload before editing.');
  await requireTracks(
    db,
    userId,
    result.playlist.items.map((i) => i.trackId),
  );
  return result;
}
export async function requireTracks(db: Prisma.TransactionClient, userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  // Stay below SQLite bind limits for large workshops and saved sessions.
  for (let offset = 0; offset < unique.length; offset += 400) {
    const batch = unique.slice(offset, offset + 400);
    const count = await db.musicTrack.count({
      where: { id: { in: batch }, ...readableMusicTrackFilter(userId) },
    });
    if (count !== batch.length) throw new StudioError(403, 'Some tracks are unavailable.');
  }
}
export async function replacePlaylistItems(
  tx: Prisma.TransactionClient,
  playlistId: string,
  items: { id: string; trackId: string }[],
) {
  // Keep unchanged rows (and their createdAt) intact. Park only changed rows in
  // distinct negative slots before reordering, preserving the unique position constraint.
  const previous = await tx.musicPlaylistItem.findMany({
    where: { playlistId },
    select: { id: true, trackId: true, position: true },
  });
  const before = new Map(previous.map((item) => [item.id, item]));
  const next = new Set(items.map((item) => item.id));
  const removed = previous.filter((item) => !next.has(item.id)).map((item) => item.id);
  for (let offset = 0; offset < removed.length; offset += 400)
    await tx.musicPlaylistItem.deleteMany({
      where: { playlistId, id: { in: removed.slice(offset, offset + 400) } },
    });
  const positioned = items.map((item, position) => ({ ...item, position }));
  const changed = positioned.filter((item) => {
    const old = before.get(item.id);
    return old && (old.position !== item.position || old.trackId !== item.trackId);
  });
  for (let offset = 0; offset < changed.length; offset += 200) {
    const ids = changed.slice(offset, offset + 200).map((item) => item.id);
    await tx.$executeRaw(
      Prisma.sql`UPDATE "MusicPlaylistItem" SET "position" = -"position" - 1 WHERE "playlistId" = ${playlistId} AND "id" IN (${Prisma.join(ids)})`,
    );
  }
  for (const item of changed)
    await tx.musicPlaylistItem.update({
      where: { id: item.id },
      data: { position: item.position, trackId: item.trackId },
    });
  const added = positioned.filter((item) => !before.has(item.id));
  for (let offset = 0; offset < added.length; offset += 200) {
    await tx.musicPlaylistItem.createMany({
      data: added.slice(offset, offset + 200).map((item) => ({ ...item, playlistId })),
    });
  }
  await tx.musicPlaylist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

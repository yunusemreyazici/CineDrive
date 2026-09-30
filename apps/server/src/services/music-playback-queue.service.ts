import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { findMusicTracksByIdsWithRelations, formatMusicTrack } from '../utils/music-format.js';

// A queue-content token, not the playback revision: position PATCHes must not
// force relation hydration. Access is rechecked even on a conditional hit.
export async function loadPlaybackQueue(
  prisma: PrismaClient,
  userId: string,
  stateId: string,
  trackWhere: Prisma.MusicTrackWhereInput,
  knownQueueVersion?: string,
) {
  const entries = await prisma.musicQueueItem.findMany({
    where: { playbackStateId: stateId, track: trackWhere },
    orderBy: [{ playOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      trackId: true,
      sourceOrder: true,
      playOrder: true,
    },
  });
  // Avoid Prisma relation includes over the entire queue (SQLite bind limit).
  const trackIds = [...new Set(entries.map((entry) => entry.trackId))];
  const stamps = new Map<string, Date>();
  for (let offset = 0; offset < trackIds.length; offset += 400) {
    const metadata = await prisma.musicTrack.findMany({
      where: { AND: [trackWhere, { id: { in: trackIds.slice(offset, offset + 400) } }] },
      select: { id: true, updatedAt: true },
    });
    metadata.forEach((track) => stamps.set(track.id, track.updatedAt));
  }
  const visibleEntries = entries.filter((entry) => stamps.has(entry.trackId));
  const queueVersion = createHash('sha256')
    .update(
      JSON.stringify([
        userId,
        stateId,
        visibleEntries.map((entry) => [entry, stamps.get(entry.trackId)]),
      ]),
    )
    .digest('hex');
  if (knownQueueVersion === queueVersion) {
    return { queueVersion, queueUnchanged: true, queue: [] };
  }
  const tracks = await findMusicTracksByIdsWithRelations(
    prisma,
    userId,
    visibleEntries.map((entry) => entry.trackId),
    trackWhere,
  );
  const byId = new Map(tracks.map((track) => [track.id, formatMusicTrack(track)]));
  return {
    queueVersion,
    queueUnchanged: false,
    queue: visibleEntries.flatMap((entry) => {
      const track = byId.get(entry.trackId);
      return track ? [{ ...entry, track }] : [];
    }),
  };
}

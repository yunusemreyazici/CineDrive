import type { Prisma } from '@cinedrive/prisma';
import type { MusicPlaylistDto } from '@cinedrive/shared';
import { readableMusicTrackFilter } from '../utils/library-access.js';
import { playlistContentVersion } from './music-studio.service.js';

export const playlistSummaryInclude = (userId: string) =>
  ({
    user: { select: { name: true } },
    memberships: { select: { userId: true, role: true, accepted: true } },
    _count: { select: { items: true } },
    items: {
      where: {
        track: { AND: [readableMusicTrackFilter(userId), { driveFile: { status: 'active' } }] },
      },
      include: { track: { select: { duration: true } } },
      orderBy: { position: 'asc' as const },
    },
  }) satisfies Prisma.MusicPlaylistInclude;

type Summary = Prisma.MusicPlaylistGetPayload<{
  include: ReturnType<typeof playlistSummaryInclude>;
}>;
export function playlistSummary(playlist: Summary, userId: string): MusicPlaylistDto {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    itemCount: playlist.items.length,
    duration: playlist.items.reduce((sum, item) => sum + (item.track.duration ?? 0), 0),
    updatedAt: playlist.updatedAt.toISOString(),
    trackIds: playlist.items.map((item) => item.trackId),
    collaboration: {
      version: playlistContentVersion(playlist.updatedAt, playlist.items),
      role:
        playlist.userId === userId
          ? 'owner'
          : playlist.memberships.find((m) => m.userId === userId)?.role === 'editor'
            ? 'editor'
            : 'listener',
      ownerName: playlist.user.name,
      memberCount: 1 + playlist.memberships.filter((m) => m.accepted).length,
      isCollaborative: playlist.memberships.length > 0 || !!playlist.invitationHash,
      unavailableCount: playlist._count.items - playlist.items.length,
    },
  };
}

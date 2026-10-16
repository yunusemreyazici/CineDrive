import {
  editWorkshopPlaylist,
  transferWorkshopItems,
  invitePlaylistMember,
} from '../services/music-playlist-workshop.service.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  musicStudioSchema,
  playlistWorkshopSchema,
  playlistTransferSchema,
  playlistInvitationSchema,
} from '@cinedrive/shared';
import {
  StudioError,
  readStudio,
  playlistAccess,
  readWorkshop,
  lockPlaylist,
  requireTracks,
} from '../services/music-studio.service.js';
import { findMusicTracksByIdsWithRelations, formatMusicTrack } from '../utils/music-format.js';
import { readableMusicTrackFilter } from '../utils/library-access.js';

export const musicStudioRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'private, no-store');
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof StudioError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: 'STUDIO_ERROR', message: error.message } });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid studio request.' } });
    throw error;
  });
  app.get('/profile', async (req) => readStudio(app.prisma, req.user!.id));
  app.put('/profile', { bodyLimit: 1024 * 1024 }, async (req) => {
    const value = musicStudioSchema.parse(req.body);
    const userId = req.user!.id;
    return app.prisma.$transaction(async (tx) => {
      await tx.musicStudio.upsert({ where: { userId }, create: { userId }, update: {} });
      await requireTracks(tx, userId, [
        ...value.families.flatMap((f) => f.trackIds),
        ...value.sessions.flatMap((s) => s.trackIds),
      ]);
      const result = await tx.musicStudio.updateMany({
        where: { userId, revision: value.revision },
        data: {
          revision: { increment: 1 },
          content: JSON.stringify({ families: value.families, sessions: value.sessions }),
        },
      });
      if (!result.count) throw new StudioError(409, 'Studio changed. Reload before saving.');
      return { ...value, revision: value.revision + 1 };
    });
  });
  app.get('/playlists', async (req) => {
    const userId = req.user!.id;
    const playlists = await app.prisma.musicPlaylist.findMany({
      where: { OR: [playlistAccess(userId), { memberships: { some: { userId } } }] },
      select: {
        id: true,
        name: true,
        userId: true,
        updatedAt: true,
        memberships: { where: { userId } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return {
      playlists: playlists.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.userId === userId ? 'owner' : (p.memberships[0]?.role ?? 'listener'),
        pending: p.userId !== userId && !p.memberships[0]?.accepted,
      })),
    };
  });
  app.get<{ Params: { id: string } }>('/playlists/:id', async (req) => {
    const userId = req.user!.id;
    const { playlist, version, role } = await readWorkshop(app.prisma, userId, req.params.id);
    const tracks = await findMusicTracksByIdsWithRelations(
      app.prisma,
      userId,
      playlist.items.map((i) => i.trackId),
      readableMusicTrackFilter(userId),
    );
    const byId = new Map(tracks.map((track) => [track.id, formatMusicTrack(track)]));
    const items = playlist.items.flatMap((item) => {
      const track = byId.get(item.trackId);
      return track ? [{ id: item.id, position: item.position, track }] : [];
    });
    const unavailableCount = playlist.items.length - items.length;
    return {
      version,
      role,
      canEdit: role !== 'listener' && unavailableCount === 0,
      unavailableCount,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        updatedAt: playlist.updatedAt.toISOString(),
        items,
        itemCount: items.length,
        duration: items.reduce((s, i) => s + (i.track.duration ?? 0), 0),
      },
      members:
        role === 'owner'
          ? playlist.memberships.map((m) => ({
              userId: m.userId,
              name: m.user.name,
              role: m.role,
              accepted: m.accepted,
            }))
          : [],
    };
  });
  app.put<{ Params: { id: string } }>(
    '/playlists/:id/items',
    { bodyLimit: 512 * 1024 },
    async (req) => {
      const value = playlistWorkshopSchema.parse(req.body);
      const userId = req.user!.id;
      return editWorkshopPlaylist(app.prisma, userId, req.params.id, value);
    },
  );
  app.post<{ Params: { id: string } }>('/playlists/:id/transfer', async (req) => {
    const value = playlistTransferSchema.parse(req.body);
    const userId = req.user!.id;
    return transferWorkshopItems(app.prisma, userId, req.params.id, value);
  });
  app.post<{ Params: { id: string } }>(
    '/playlists/:id/invite',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const value = playlistInvitationSchema.parse(req.body);
      await invitePlaylistMember(app.prisma, req.user!.id, req.params.id, value);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>('/playlists/:id/accept', async (req) => {
    const result = await app.prisma.musicPlaylistMembership.updateMany({
      where: { playlistId: req.params.id, userId: req.user!.id },
      data: { accepted: true },
    });
    if (!result.count) throw new StudioError(404, 'Invitation not found.');
    return { ok: true };
  });
  app.delete<{ Params: { id: string; userId: string } }>(
    '/playlists/:id/members/:userId',
    async (req) => {
      await app.prisma.$transaction(async (tx) => {
        await lockPlaylist(tx, req.params.id);
        if (req.params.userId !== req.user!.id) {
          const { role } = await readWorkshop(tx, req.user!.id, req.params.id);
          if (role !== 'owner') throw new StudioError(403, 'Only the owner may revoke.');
        }
        await tx.musicPlaylistMembership.deleteMany({
          where: { playlistId: req.params.id, userId: req.params.userId },
        });
      });
      return { ok: true };
    },
  );
};

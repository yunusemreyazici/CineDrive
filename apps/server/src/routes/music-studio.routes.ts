import {
  editWorkshopPlaylist,
  transferWorkshopItems,
  invitePlaylistMember,
} from '../services/music-playlist-workshop.service.js';
import {
  createPlaylistLink,
  previewPlaylistLink,
  acceptPlaylistLink,
  revokePlaylistLink,
} from '../services/music-playlist-invitation.service.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { playlistRecommendationsSchema } from '@cinedrive/shared';
import { playlistRecommendations } from '../services/music-playlist-recommendations.service.js';
import {
  musicStudioSchema,
  playlistWorkshopSchema,
  playlistTransferSchema,
  playlistInvitationSchema,
  studioCreatePlaylistSchema,
  studioRestoreSchema,
  studioPageSchema,
  studioChangeQuerySchema,
} from '@cinedrive/shared';
import {
  StudioError,
  readStudio,
  readWorkshop,
  lockPlaylist,
  requireTracks,
} from '../services/music-studio.service.js';
import { findMusicTracksByIdsWithRelations, formatMusicTrack } from '../utils/music-format.js';
import { readableMusicTrackFilter } from '../utils/library-access.js';
import {
  createStudioPlaylist,
  studioDirectory,
  studioChanges,
  studioHistory,
  studioRevisionItems,
  restoreStudioRevision,
} from '../services/music-studio-sync.service.js';
import { notifyStudioChange } from '../services/music-studio-journal.service.js';
import { studioHealth } from '../services/music-studio-health.service.js';
import type { MusicLanguageEnrichmentService } from '../services/music-language-enrichment.service.js';
import type { BackgroundJobObservation } from '../services/background-job-observation.js';

export const musicStudioRoutes: FastifyPluginAsync<{
  languageStats: MusicLanguageEnrichmentService['stats'];
  workers: () => Record<string, ReturnType<BackgroundJobObservation['snapshot']>>;
}> = async (app, options) => {
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
  app.post<{ Params: { id: string } }>(
    '/playlists/:id/recommendations',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req) => {
      const value = playlistRecommendationsSchema.parse(req.body);
      return playlistRecommendations(
        app.prisma,
        req.user!.id,
        req.params.id,
        value.generationId,
        value.excludeIds,
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    '/playlists/:id/invitation-link',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => createPlaylistLink(app.prisma, req.user!.id, req.params.id),
  );
  app.delete<{ Params: { id: string } }>('/playlists/:id/invitation-link', async (req) => {
    await revokePlaylistLink(app.prisma, req.user!.id, req.params.id);
    return { ok: true };
  });
  app.post(
    '/invitations/preview',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { token } = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(req.body);
      return previewPlaylistLink(app.prisma, req.user!.id, token);
    },
  );
  app.post(
    '/invitations/accept',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { token } = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(req.body);
      return acceptPlaylistLink(app.prisma, req.user!.id, token);
    },
  );
  app.get<{ Params: { id: string } }>('/families/:id/tracks', async (req) => {
    const profile = await readStudio(app.prisma, req.user!.id);
    const family = profile.families.find((f) => f.id === req.params.id);
    if (!family) throw new StudioError(404, 'Family not found.');
    return {
      tracks: await app.prisma.musicTrack.findMany({
        where: {
          AND: [
            readableMusicTrackFilter(req.user!.id),
            { id: { in: family.trackIds }, driveFile: { status: 'active' } },
          ],
        },
        select: {
          id: true,
          title: true,
          primaryArtist: { select: { name: true } },
          album: { select: { title: true } },
        },
      }),
    };
  });
  app.get<{ Params: { id: string } }>('/sessions/:id/tracks', async (req) => {
    const profile = await readStudio(app.prisma, req.user!.id);
    const session = profile.sessions.find((s) => s.id === req.params.id);
    if (!session) throw new StudioError(404, 'Session not found.');
    const tracks = await findMusicTracksByIdsWithRelations(
      app.prisma,
      req.user!.id,
      session.trackIds,
      readableMusicTrackFilter(req.user!.id),
    );
    const lookup = new Map(tracks.map((track) => [track.id, formatMusicTrack(track)]));
    if (session.trackIds.some((id) => !lookup.has(id)))
      throw new StudioError(409, 'Some session tracks are unavailable.');
    return {
      tracks: session.trackIds.map((id) => lookup.get(id)!),
      index: session.index,
      position: session.position,
    };
  });
  app.get(
    '/health',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req) => ({
      ...(await studioHealth(app.prisma, req.user!.id)),
      enrichment: await options.languageStats(req.user!.id),
      // Global scheduler state is administrative; ordinary users see only their catalogue jobs.
      workers: req.user!.role === 'admin' ? options.workers() : null,
    }),
  );
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
    // Older clients keep the previous 200-row default; new clients request pages.
    const query = studioPageSchema.parse({ limit: 200, ...(req.query as object) });
    return studioDirectory(app.prisma, req.user!.id, query.cursor, query.limit);
  });
  app.post('/playlists', async (req) =>
    createStudioPlaylist(app.prisma, req.user!.id, studioCreatePlaylistSchema.parse(req.body)),
  );
  app.get('/changes', async (req) => {
    const query = studioChangeQuerySchema.parse(req.query);
    return studioChanges(app.prisma, req.user!.id, query.cursor);
  });
  app.get<{ Params: { id: string } }>('/playlists/:id/history', async (req) => {
    const query = studioPageSchema.parse(req.query);
    return studioHistory(app.prisma, req.user!.id, req.params.id, query.cursor, query.limit);
  });
  app.post<{ Params: { id: string; revisionId: string } }>(
    '/playlists/:id/history/:revisionId/restore',
    async (req) => {
      const revisionId = z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(req.params.revisionId);
      return restoreStudioRevision(
        app.prisma,
        req.user!.id,
        req.params.id,
        revisionId,
        studioRestoreSchema.parse(req.body),
      );
    },
  );
  app.get<{ Params: { id: string; revisionId: string } }>(
    '/playlists/:id/history/:revisionId/items',
    async (req) => {
      const revisionId = z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(req.params.revisionId);
      const query = studioPageSchema.parse(req.query);
      return studioRevisionItems(app.prisma, req.user!.id, req.params.id, revisionId, query.cursor);
    },
  );
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
      participants: [
        ...(
          await app.prisma.user.findMany({
            where: { id: playlist.userId },
            select: { id: true, name: true },
          })
        ).map((u) => ({ userId: u.id, name: u.name, role: 'owner', accepted: true })),
        ...playlist.memberships
          .filter((m) => m.accepted)
          .map((m) => ({
            userId: m.userId,
            name: m.user.name,
            role: m.role,
            accepted: m.accepted,
          })),
      ],
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
    await app.prisma.$transaction(async (tx) => {
      await lockPlaylist(tx, req.params.id);
      const result = await tx.musicPlaylistMembership.updateMany({
        where: { playlistId: req.params.id, userId: req.user!.id },
        data: { accepted: true },
      });
      if (!result.count) throw new StudioError(404, 'Invitation not found.');
      await notifyStudioChange(tx, req.params.id, 'membership');
    });
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
        const removed = await tx.musicPlaylistMembership.deleteMany({
          where: { playlistId: req.params.id, userId: req.params.userId },
        });
        if (!removed.count) throw new StudioError(404, 'Membership not found.');
        // A removed member cannot rejoin with a previously issued bearer link.
        if (req.params.userId !== req.user!.id)
          await tx.musicPlaylist.update({
            where: { id: req.params.id },
            data: { invitationHash: null, invitationExpiresAt: null },
          });
        await notifyStudioChange(tx, req.params.id, 'membership', [req.params.userId]);
      });
      return { ok: true };
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import { musicPersonalizationSchema } from '@cinedrive/shared';
import {
  readMusicPersonalization,
  meaningfulLastPlays,
  matchesSmartRule,
} from '../services/music-personalization.service.js';
import { loadDiscoveryCandidates } from '../services/music-discovery-candidates.js';
import { readableMusicTrackFilter } from '../utils/library-access.js';

export const musicPersonalizationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'private, no-store');
    return payload;
  });
  app.get(
    '/',
    async (request) => (await readMusicPersonalization(app.prisma, request.user!.id)).value,
  );
  app.put('/', { bodyLimit: 128 * 1024 }, async (request, reply) => {
    const parsed = musicPersonalizationSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid personalization.' } });
    const userId = request.user!.id;
    const current = await readMusicPersonalization(app.prisma, userId);
    if (parsed.data.revision !== current.value.revision)
      return reply
        .code(409)
        .send({
          error: {
            code: 'REVISION_CONFLICT',
            message: 'Preferences changed on another device. Reload and retry.',
          },
        });
    const ids = parsed.data.feedback.map((item) => item.trackId);
    if (ids.length) {
      const accessible = await app.prisma.musicTrack.count({
        where: { id: { in: ids }, ...readableMusicTrackFilter(userId) },
      });
      if (accessible !== ids.length)
        return reply
          .code(400)
          .send({
            error: { code: 'VALIDATION_ERROR', message: 'Feedback contains unavailable tracks.' },
          });
    }
    const now = Date.now();
    if (
      parsed.data.feedback.some(
        (item) =>
          item.kind === 'snoozeArtist' &&
          (!item.expiresAt || Date.parse(item.expiresAt) > now + 31 * 86_400_000),
      )
    )
      return reply
        .code(400)
        .send({
          error: { code: 'VALIDATION_ERROR', message: 'Artist snooze must expire within 31 days.' },
        });
    const value = { ...parsed.data, revision: current.value.revision + 1 };
    const result = await app.prisma.user.updateMany({
      where: { id: userId, musicPersonalization: current.raw },
      data: { musicPersonalization: JSON.stringify(value) },
    });
    if (!result.count)
      return reply
        .code(409)
        .send({ error: { code: 'REVISION_CONFLICT', message: 'Reload preferences and retry.' } });
    return value;
  });
  app.get<{ Params: { id: string } }>(
    '/smart/:id',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = request.user!.id;
      const { value } = await readMusicPersonalization(app.prisma, userId);
      const rule = value.smartLists.find((item) => item.id === request.params.id);
      if (!rule)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Smart list not found.' } });
      const [candidates, history] = await Promise.all([
        loadDiscoveryCandidates(app.prisma, userId),
        meaningfulLastPlays(app.prisma, userId),
      ]);
      const now = Date.now();
      const matches = candidates
        .filter((track) => matchesSmartRule(track, rule, history.get(track.id), now))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
      // Downloaded-only lists must intersect the full matching ID set on-device before limiting.
      return {
        trackIds: matches.map((track) => track.id),
        matchedCount: matches.length,
        limit: rule.limit,
        downloadedOnly: rule.downloadedOnly,
      };
    },
  );
};

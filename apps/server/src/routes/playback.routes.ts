import type { FastifyPluginAsync } from 'fastify';
import { updateProgressSchema } from '@cinedrive/shared';

const deviceTypeFromUserAgent = (userAgent = '') => {
  const normalized = userAgent.toLowerCase();
  if (/ipad|tablet/.test(normalized)) return 'tablet';
  if (/mobile|iphone|android/.test(normalized)) return 'mobile';
  return normalized ? 'desktop' : 'unknown';
};

export const playbackRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // PUT /api/playback/progress: Record/update position
  fastify.put('/progress', async (request, reply) => {
    const parseResult = updateProgressSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz parametre değerleri.',
          details: parseResult.error.errors,
          requestId: request.id,
        },
      });
    }

    const userId = request.user!.id;
    const clientTimestamp = (request.body as { clientTimestamp?: number })?.clientTimestamp;

    try {
      const progress = await fastify.playbackService.updateProgress(userId, {
        ...parseResult.data,
        clientTimestamp,
        deviceType: deviceTypeFromUserAgent(request.headers['user-agent']),
      });

      return reply.status(200).send({ progress });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message === 'MEDIA_NOT_FOUND') {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_NOT_FOUND',
            message: 'İlgili medya içeriği bulunamadı.',
            requestId: request.id,
          },
        });
      }

      if (message === 'INVALID_EPISODE') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_EPISODE',
            message: 'Geçersiz bölüm ID veya medya ilişkisi uyuşmuyor.',
            requestId: request.id,
          },
        });
      }

      if (message === 'INVALID_NUMERIC_VALUES') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_NUMERIC_VALUES',
            message: 'Pozisyon veya süre değerleri sıfırdan küçük ya da geçersiz olamaz.',
            requestId: request.id,
          },
        });
      }

      throw err;
    }
  });

  // GET /api/playback/continue: "Continue Watching" list
  fastify.get('/continue', async (request, reply) => {
    const userId = request.user!.id;
    const items = await fastify.playbackService.getContinueWatchingList(userId);
    return reply.status(200).send({ items });
  });

  // GET /api/playback/:mediaItemId: Single media item progress
  fastify.get<{ Params: { mediaItemId: string } }>('/:mediaItemId', async (request, reply) => {
    const { mediaItemId } = request.params;
    const userId = request.user!.id;
    const progressList = await fastify.playbackService.getMediaProgress(userId, mediaItemId);
    return reply.status(200).send({ progress: progressList[0] || null, all: progressList });
  });

  // DELETE /api/playback/:mediaItemId: Reset media progress
  fastify.delete<{ Params: { mediaItemId: string } }>('/:mediaItemId', async (request, reply) => {
    const { mediaItemId } = request.params;
    const userId = request.user!.id;
    await fastify.playbackService.resetProgress(userId, mediaItemId);
    return reply.status(200).send({ message: 'Progress reset successfully' });
  });
};

// Registered under /api/history
export const historyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/history: Paginated watch history
  fastify.get<{ Querystring: { page?: string; limit?: string; type?: string } }>(
    '/',
    async (request, reply) => {
      const userId = request.user!.id;
      const page = request.query.page ? parseInt(request.query.page, 10) : 1;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
      const type = request.query.type;

      const result = await fastify.playbackService.getWatchHistory(userId, {
        page,
        limit,
        type,
      });

      return reply.status(200).send(result);
    },
  );

  // DELETE /api/history/:id: Delete single history item
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    try {
      await fastify.playbackService.deleteWatchHistoryItem(userId, id);
      return reply.status(200).send({ message: 'History item deleted successfully' });
    } catch {
      return reply.status(404).send({
        error: {
          code: 'HISTORY_NOT_FOUND',
          message: 'Geçmiş kaydı bulunamadı veya yetkiniz yok.',
          requestId: request.id,
        },
      });
    }
  });

  // DELETE /api/history: Clear all watch history
  fastify.delete('/', async (request, reply) => {
    const userId = request.user!.id;
    await fastify.playbackService.clearWatchHistory(userId);
    return reply
      .status(200)
      .send({ message: 'History and playback progress cleared successfully' });
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { updateProgressSchema, type UpdateProgressInput, DEFAULT_COMPLETION_THRESHOLD_PERCENT } from '@cinedrive/shared';

export const playbackRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/playback/continue: Return in-progress media items
  fastify.get('/continue', async (request, reply) => {
    const userId = request.user!.id;

    const inProgress = await fastify.prisma.playbackProgress.findMany({
      where: {
        userId,
        completed: false,
        positionSeconds: { gt: 10 }, // Only include items watched for > 10s
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: {
        mediaItem: true,
        episode: true,
      },
    });

    return reply.status(200).send({ items: inProgress });
  });

  // PUT /api/playback/progress: Save position & completion state
  fastify.put<{ Body: UpdateProgressInput }>('/progress', async (request, reply) => {
    const userId = request.user!.id;
    const parseResult = updateProgressSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz oynatma ilerlemesi verisi.',
          requestId: request.id,
          details: parseResult.error.format(),
        },
      });
    }

    const { mediaItemId, episodeId, positionSeconds, durationSeconds } = parseResult.data;

    const percentage = durationSeconds > 0 ? (positionSeconds / durationSeconds) * 100 : 0;
    const completed = percentage >= DEFAULT_COMPLETION_THRESHOLD_PERCENT;

    const record = await fastify.prisma.playbackProgress.upsert({
      where: {
        userId_mediaItemId_episodeId: {
          userId,
          mediaItemId,
          episodeId: episodeId || '',
        },
      },
      create: {
        userId,
        mediaItemId,
        episodeId: episodeId || '',
        positionSeconds,
        durationSeconds,
        percentage,
        completed,
      },
      update: {
        positionSeconds,
        durationSeconds,
        percentage,
        completed,
      },
    });

    // Record in WatchHistory
    await fastify.prisma.watchHistory.create({
      data: {
        userId,
        mediaItemId,
        watchedAt: new Date(),
      },
    });

    return reply.status(200).send({ progress: record });
  });

  // GET /api/history: List watch history
  fastify.get('/history', async (request, reply) => {
    const userId = request.user!.id;

    const history = await fastify.prisma.watchHistory.findMany({
      where: { userId },
      orderBy: { watchedAt: 'desc' },
      take: 50,
      include: {
        mediaItem: {
          include: {
            playbackProgresses: {
              where: { userId },
            },
          },
        },
      },
    });

    return reply.status(200).send({ history });
  });

  // DELETE /api/history/:id: Delete watch history entry
  fastify.delete<{ Params: { id: string } }>('/history/:id', async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    await fastify.prisma.watchHistory.deleteMany({
      where: { id, userId },
    });

    return reply.status(200).send({ success: true });
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { ownedMediaFilter } from '../utils/library-access.js';

export const favoriteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/favorites: List user favorites
  fastify.get('/', async (request, reply) => {
    const userId = request.user!.id;

    const favorites = await fastify.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        mediaItem: {
          include: {
            movie: true,
            series: true,
            playbackProgresses: {
              where: { userId },
            },
          },
        },
      },
    });

    const enriched = favorites.map((f) => ({
      ...f.mediaItem,
      isFavorite: true,
      progress: f.mediaItem.playbackProgresses[0] || null,
    }));

    return reply.status(200).send({ favorites: enriched });
  });

  // POST /api/favorites/:mediaItemId: Add to favorites
  fastify.post<{ Params: { mediaItemId: string } }>('/:mediaItemId', async (request, reply) => {
    const { mediaItemId } = request.params;
    const userId = request.user!.id;

    // Favouriting reached any media row by id, so a title from another
    // account could be added to this account's favourites.
    const item = await fastify.prisma.mediaItem.findFirst({
      where: { id: mediaItemId, ...ownedMediaFilter(userId) },
    });
    if (!item) {
      return reply.status(404).send({
        error: {
          code: 'MEDIA_NOT_FOUND',
          message: 'Favoriye eklenecek medya içeriği bulunamadı.',
          requestId: request.id,
        },
      });
    }

    const favorite = await fastify.prisma.favorite.upsert({
      where: {
        userId_mediaItemId: {
          userId,
          mediaItemId,
        },
      },
      create: { userId, mediaItemId },
      update: {},
    });

    return reply.status(201).send({ favorite });
  });

  // DELETE /api/favorites/:mediaItemId: Remove from favorites
  fastify.delete<{ Params: { mediaItemId: string } }>('/:mediaItemId', async (request, reply) => {
    const { mediaItemId } = request.params;
    const userId = request.user!.id;

    await fastify.prisma.favorite.deleteMany({
      where: { userId, mediaItemId },
    });

    return reply.status(200).send({ success: true });
  });
};

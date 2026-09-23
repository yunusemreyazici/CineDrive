import type { FastifyPluginAsync } from 'fastify';
import { mediaQuerySchema } from '@cinedrive/shared';
import { ownedMediaFilter } from '../utils/library-access.js';

const favoriteMediaSelect = (userId: string) => ({
  id: true,
  type: true,
  title: true,
  originalTitle: true,
  normalizedTitle: true,
  year: true,
  overview: true,
  posterDriveFileId: true,
  backdropDriveFileId: true,
  posterUrl: true,
  backdropUrl: true,
  duration: true,
  voteAverage: true,
  voteCount: true,
  genres: true,
  trailerUrl: true,
  contentRating: true,
  tmdbId: true,
  imdbId: true,
  createdAt: true,
  updatedAt: true,
  playbackProgresses: {
    where: { userId },
    orderBy: { lastPlayedAt: 'desc' as const },
    take: 1,
    select: {
      positionSeconds: true,
      durationSeconds: true,
      percentage: true,
      completed: true,
      serverRevision: true,
    },
  },
});

function parseGenres(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((genre) => typeof genre === 'string') ? value : [];
  } catch {
    return [];
  }
}

export const favoriteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/favorites: List user favorites
  fastify.get('/', async (request, reply) => {
    const parseResult = mediaQuerySchema.pick({ page: true, limit: true }).safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Favori listeleme parametreleri geçersiz.',
          requestId: request.id,
          details: parseResult.error.format(),
        },
      });
    }

    const { page, limit } = parseResult.data;
    const userId = request.user!.id;
    const where = { userId, mediaItem: ownedMediaFilter(userId) };

    const [favorites, total] = await Promise.all([
      fastify.prisma.favorite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          mediaItem: {
            select: favoriteMediaSelect(userId),
          },
        },
      }),
      fastify.prisma.favorite.count({ where }),
    ]);

    const enriched = favorites.map((f) => ({
      ...f.mediaItem,
      genres: parseGenres(f.mediaItem.genres),
      isFavorite: true,
      progress: f.mediaItem.playbackProgresses[0] || null,
      posterUrl: f.mediaItem.posterDriveFileId
        ? `/api/media/assets/${f.mediaItem.posterDriveFileId}`
        : f.mediaItem.posterUrl,
      backdropUrl: f.mediaItem.backdropDriveFileId
        ? `/api/media/assets/${f.mediaItem.backdropDriveFileId}`
        : f.mediaItem.backdropUrl,
    }));

    return reply.status(200).send({
      favorites: enriched,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
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

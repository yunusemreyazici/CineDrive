import type { FastifyPluginAsync } from 'fastify';
import { mediaQuerySchema } from '@cinedrive/shared';
import type { Prisma } from '@prisma/client';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const mediaQueryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/media: Filter & Search Media Items
  fastify.get('/', async (request, reply) => {
    const parseResult = mediaQuerySchema.safeParse(request.query);
    const { type, year, search, sortBy, sortOrder, page, limit } = parseResult.success
      ? parseResult.data
      : { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    const where: Prisma.MediaItemWhereInput = {};
    if (type) where.type = type;
    if (year) where.year = year;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { normalizedTitle: { contains: search.toLowerCase() } },
      ];
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      fastify.prisma.mediaItem.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
        include: {
          movie: true,
          series: {
            include: {
              seasons: {
                include: { episodes: true },
              },
            },
          },
          subtitles: {
            include: { driveFile: true },
          },
        },
      }),
      fastify.prisma.mediaItem.count({ where }),
    ]);

    const userId = request.user!.id;
    const favorites = await fastify.prisma.favorite.findMany({
      where: { userId },
      select: { mediaItemId: true },
    });
    const favoriteSet = new Set(favorites.map((f) => f.mediaItemId));

    const progressList = await fastify.prisma.playbackProgress.findMany({
      where: { userId },
    });
    const progressMap = new Map(progressList.map((p) => [p.mediaItemId, p]));

    const enrichedItems = items.map((item) => ({
      ...item,
      genres: safeJsonParse<string[]>(item.genres, []),
      cast: safeJsonParse<Array<{ name: string; character?: string; profileUrl?: string }>>(item.cast, []),
      isFavorite: favoriteSet.has(item.id),
      progress: progressMap.get(item.id) || null,
      posterUrl: item.posterDriveFileId ? `/api/media/assets/${item.posterDriveFileId}` : item.posterUrl || null,
      backdropUrl: item.backdropDriveFileId ? `/api/media/assets/${item.backdropDriveFileId}` : item.backdropUrl || null,
      subtitles: item.subtitles.map((sub) => ({
        id: sub.id,
        languageCode: sub.language,
        languageLabel: sub.label || sub.language.toUpperCase(),
        forced: sub.isForced,
        hearingImpaired: sub.isHearingImpaired,
        isDefault: sub.isDefault,
        url: `/api/media/${sub.driveFile.googleDriveFileId}/subtitle`,
      })),
    }));

    return reply.status(200).send({
      media: enrichedItems,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  // GET /api/media/:id: Detail View
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const item = await fastify.prisma.mediaItem.findUnique({
      where: { id },
      include: {
        movie: true,
        series: {
          include: {
            seasons: {
              orderBy: { seasonNumber: 'asc' },
              include: {
                episodes: {
                  orderBy: { episodeNumber: 'asc' },
                  include: {
                    subtitles: {
                      include: { driveFile: true },
                    },
                    playbackProgresses: {
                      where: { userId },
                    },
                  },
                },
              },
            },
          },
        },
        subtitles: {
          include: { driveFile: true },
        },
        playbackProgresses: {
          where: { userId },
        },
        favorites: {
          where: { userId },
        },
      },
    });

    if (!item) {
      return reply.status(404).send({
        error: {
          code: 'MEDIA_NOT_FOUND',
          message: 'Medya içeriği bulunamadı.',
          requestId: request.id,
        },
      });
    }

    const formattedSubtitles = item.subtitles.map((sub) => ({
      id: sub.id,
      languageCode: sub.language,
      languageLabel: sub.label || sub.language.toUpperCase(),
      forced: sub.isForced,
      hearingImpaired: sub.isHearingImpaired,
      isDefault: sub.isDefault,
      url: `/api/media/${sub.driveFile.googleDriveFileId}/subtitle`,
    }));

    const formattedSeries = item.series
      ? {
          ...item.series,
          seasons: item.series.seasons.map((season) => ({
            ...season,
            episodes: season.episodes.map((ep) => ({
              ...ep,
              subtitles: ep.subtitles.map((sub) => ({
                id: sub.id,
                languageCode: sub.language,
                languageLabel: sub.label || sub.language.toUpperCase(),
                forced: sub.isForced,
                hearingImpaired: sub.isHearingImpaired,
                isDefault: sub.isDefault,
                url: `/api/media/${sub.driveFile.googleDriveFileId}/subtitle`,
              })),
            })),
          })),
        }
      : null;

    return reply.status(200).send({
      media: {
        ...item,
        genres: safeJsonParse<string[]>(item.genres, []),
        cast: safeJsonParse<Array<{ name: string; character?: string; profileUrl?: string }>>(item.cast, []),
        isFavorite: item.favorites.length > 0,
        progress: item.playbackProgresses[0] || null,
        posterUrl: item.posterDriveFileId ? `/api/media/assets/${item.posterDriveFileId}` : item.posterUrl || null,
        backdropUrl: item.backdropDriveFileId ? `/api/media/assets/${item.backdropDriveFileId}` : item.backdropUrl || null,
        subtitles: formattedSubtitles,
        series: formattedSeries,
      },
    });
  });

  // GET /api/series/:id/seasons
  fastify.get<{ Params: { id: string } }>('/series/:id/seasons', async (request, reply) => {
    const { id } = request.params;
    const seasons = await fastify.prisma.season.findMany({
      where: { seriesId: id },
      orderBy: { seasonNumber: 'asc' },
      include: {
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          include: {
            subtitles: {
              include: { driveFile: true },
            },
          },
        },
      },
    });

    return reply.status(200).send({ seasons });
  });

  // GET /api/seasons/:id/episodes
  fastify.get<{ Params: { id: string } }>('/seasons/:id/episodes', async (request, reply) => {
    const { id } = request.params;
    const episodes = await fastify.prisma.episode.findMany({
      where: { seasonId: id },
      orderBy: { episodeNumber: 'asc' },
      include: {
        subtitles: {
          include: { driveFile: true },
        },
      },
    });

    const formattedEpisodes = episodes.map((ep) => ({
      ...ep,
      subtitles: ep.subtitles.map((sub) => ({
        id: sub.id,
        languageCode: sub.language,
        languageLabel: sub.label || sub.language.toUpperCase(),
        forced: sub.isForced,
        hearingImpaired: sub.isHearingImpaired,
        isDefault: sub.isDefault,
        url: `/api/media/${sub.driveFile.googleDriveFileId}/subtitle`,
      })),
    }));

    return reply.status(200).send({ episodes: formattedEpisodes });
  });

  // GET /api/assets/:driveFileId: Serve image asset
  fastify.get<{ Params: { driveFileId: string } }>('/assets/:driveFileId', async (request, reply) => {
    const { driveFileId } = request.params;
    const userId = request.user!.id;

    try {
      const accessToken = await fastify.googleOAuthService.getValidAccessToken(userId);
      const driveStreamRes = await fastify.driveService.createMediaStream(accessToken, driveFileId);

      reply.status(200);
      if (driveStreamRes.headers['content-type']) {
        reply.header('Content-Type', driveStreamRes.headers['content-type']);
      }
      reply.header('Cache-Control', 'public, max-age=86400'); // Cache image for 24h

      return reply.send(driveStreamRes.stream);
    } catch {
      return reply.status(404).send({
        error: {
          code: 'ASSET_NOT_FOUND',
          message: 'Görsel yüklenemedi.',
          requestId: request.id,
        },
      });
    }
  });
};

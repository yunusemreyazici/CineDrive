import type { FastifyPluginAsync } from 'fastify';
import { mediaQuerySchema } from '@cinedrive/shared';
import type { Prisma } from '@prisma/client';
import { buildPlaybackPlan } from '../services/playback-plan.service.js';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const technicalMetadataSelect = {
  mediaContainer: true,
  videoCodec: true,
  videoProfile: true,
  videoBitDepth: true,
  audioCodec: true,
  audioChannels: true,
  mediaWidth: true,
  mediaHeight: true,
  mediaDuration: true,
  mediaAnalyzedAt: true,
  mediaAnalysisError: true,
} satisfies Prisma.DriveFileSelect;

export const mediaQueryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/media: Filter & Search Media Items
  fastify.get('/', async (request, reply) => {
    const parseResult = mediaQuerySchema.safeParse(request.query);
    const { type, genre, person, year, yearFrom, yearTo, minRating, search, sortBy, sortOrder, page, limit } = parseResult.success
      ? parseResult.data
      : { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    const where: Prisma.MediaItemWhereInput = {};
    if (type) where.type = type;
    if (genre) where.genres = { contains: genre };
    if (person) where.cast = { contains: person };

    if (year) {
      where.year = year;
    } else if (yearFrom || yearTo) {
      where.year = {
        ...(yearFrom ? { gte: yearFrom } : {}),
        ...(yearTo ? { lte: yearTo } : {}),
      };
    }

    if (minRating) {
      where.voteAverage = { gte: minRating };
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { normalizedTitle: { contains: search.toLowerCase() } },
        { cast: { contains: search } },
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

  // GET /api/media/random: Get a random media item matching criteria
  fastify.get<{ Querystring: { type?: string; minRating?: string } }>(
    '/random',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const type = request.query.type;
      const minRating = request.query.minRating ? parseFloat(request.query.minRating) : undefined;

      const where: Prisma.MediaItemWhereInput = {};
      if (type && (type === 'movie' || type === 'series')) where.type = type;
      if (minRating) where.voteAverage = { gte: minRating };

      const totalCount = await fastify.prisma.mediaItem.count({ where });
      if (totalCount === 0) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_NOT_FOUND',
            message: 'Kriterlere uygun medya bulunamadı.',
            requestId: request.id,
          },
        });
      }

      const randomIndex = Math.floor(Math.random() * totalCount);
      const items = await fastify.prisma.mediaItem.findMany({
        where,
        skip: randomIndex,
        take: 1,
        include: {
          movie: true,
          series: {
            include: {
              seasons: {
                include: { episodes: true },
              },
            },
          },
        },
      });

      const media = items[0];
      if (!media) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_NOT_FOUND',
            message: 'Medya bulunamadı.',
            requestId: request.id,
          },
        });
      }

      const userId = request.user!.id;
      const isFavorite = await fastify.prisma.favorite.findUnique({
        where: { userId_mediaItemId: { userId, mediaItemId: media.id } },
      });

      const progress = await fastify.prisma.playbackProgress.findFirst({
        where: { userId, mediaItemId: media.id },
      });

      const enrichedMedia = {
        ...media,
        genres: safeJsonParse<string[]>(media.genres, []),
        cast: safeJsonParse<Array<{ name: string; character?: string; profileUrl?: string }>>(media.cast, []),
        isFavorite: !!isFavorite,
        progress: progress || null,
        posterUrl: media.posterDriveFileId ? `/api/media/assets/${media.posterDriveFileId}` : media.posterUrl || null,
        backdropUrl: media.backdropDriveFileId ? `/api/media/assets/${media.backdropDriveFileId}` : media.backdropUrl || null,
      };

      return reply.status(200).send({ media: enrichedMedia });
    },
  );

  // GET /api/media/:id: Detail View
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const item = await fastify.prisma.mediaItem.findUnique({
      where: { id },
      include: {
        movie: {
          include: {
            driveFile: { select: technicalMetadataSelect },
          },
        },
        series: {
          include: {
            seasons: {
              orderBy: { seasonNumber: 'asc' },
              include: {
                episodes: {
                  orderBy: { episodeNumber: 'asc' },
                  include: {
                    driveFile: { select: technicalMetadataSelect },
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
            episodes: season.episodes.map((ep) => {
              const { driveFile, ...episode } = ep;
              return {
                ...episode,
                technicalMetadata: driveFile,
                playbackPlan: buildPlaybackPlan(driveFile),
                subtitles: ep.subtitles.map((sub) => ({
                  id: sub.id,
                  languageCode: sub.language,
                  languageLabel: sub.label || sub.language.toUpperCase(),
                  forced: sub.isForced,
                  hearingImpaired: sub.isHearingImpaired,
                  isDefault: sub.isDefault,
                  url: `/api/media/${sub.driveFile.googleDriveFileId}/subtitle`,
                })),
              };
            }),
          })),
        }
      : null;
    const formattedMovie = item.movie
      ? {
          id: item.movie.id,
          mediaItemId: item.movie.mediaItemId,
          driveFileId: item.movie.driveFileId,
          technicalMetadata: item.movie.driveFile,
          playbackPlan: buildPlaybackPlan(item.movie.driveFile || {}),
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
        movie: formattedMovie,
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

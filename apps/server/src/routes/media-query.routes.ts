import type { FastifyPluginAsync } from 'fastify';
import { mediaQuerySchema } from '@cinedrive/shared';
import type { Prisma } from '@cinedrive/prisma';
import { buildPlaybackPlan } from '../services/playback-plan.service.js';
import { ownedMediaFilter } from '../utils/library-access.js';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Everything a grid, rail or hero renders — which is every scalar column
 * except `cast`. Cast was 1.3 kB of a 2.3 kB list item, more than half the
 * response, and only the detail page reads it. Filtering by person still works
 * because that is a `where` clause, not a returned column.
 */
const listItemSelect = {
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
} satisfies Prisma.MediaItemSelect;

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
    const { type, genre, person, year, yearFrom, yearTo, minRating, search, hideWithoutMetadata, sortBy, sortOrder, page, limit } = parseResult.success
      ? parseResult.data
      : { page: 1, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };

    /*
     * Every list request now starts from the caller's own libraries. Until
     * `MediaItem.libraryId` existed there was no cheap way to express this, and
     * the endpoint simply returned every media row in the database — favourites
     * and progress were scoped to the user, the catalogue itself was not.
     */
    const where: Prisma.MediaItemWhereInput = { ...ownedMediaFilter(request.user!.id) };
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

    // This preference hides only unmatched movies. Series and manually managed
    // items remain available, and the media manager intentionally bypasses it.
    if (hideWithoutMetadata) {
      where.AND = [
        {
          OR: [{ type: 'series' }, { type: 'movie', tmdbId: { not: null } }],
        },
      ];
    }

    const skip = (page - 1) * limit;

    // Grids and rails render a poster, a title and a year. This used to eager
    // load every season, every episode and every subtitle track of every
    // series on the page — data no list view reads, and the single largest
    // contributor to the response size. Callers that need the full tree use
    // GET /api/media/:id.
    const [items, total] = await Promise.all([
      fastify.prisma.mediaItem.findMany({
        where,
        select: listItemSelect,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      fastify.prisma.mediaItem.count({ where }),
    ]);

    // Scoped to the page. These used to fetch every favourite and every
    // progress row the account owns on every list request, so the cost grew
    // with watch history rather than with page size.
    const userId = request.user!.id;
    const pageItemIds = items.map((item) => item.id);

    const [favorites, progressList] = await Promise.all([
      fastify.prisma.favorite.findMany({
        where: { userId, mediaItemId: { in: pageItemIds } },
        select: { mediaItemId: true },
      }),
      fastify.prisma.playbackProgress.findMany({
        where: { userId, mediaItemId: { in: pageItemIds } },
      }),
    ]);

    const favoriteSet = new Set(favorites.map((f) => f.mediaItemId));
    const progressMap = new Map(progressList.map((p) => [p.mediaItemId, p]));

    const enrichedItems = items.map((item) => ({
      ...item,
      genres: safeJsonParse<string[]>(item.genres, []),
      isFavorite: favoriteSet.has(item.id),
      progress: progressMap.get(item.id) || null,
      posterUrl: item.posterDriveFileId ? `/api/media/assets/${item.posterDriveFileId}` : item.posterUrl || null,
      backdropUrl: item.backdropDriveFileId ? `/api/media/assets/${item.backdropDriveFileId}` : item.backdropUrl || null,
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

      // The dice used to roll across every library in the database.
      const where: Prisma.MediaItemWhereInput = { ...ownedMediaFilter(request.user!.id) };
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

    // Media the caller does not own answers like media that does not exist.
    const item = await fastify.prisma.mediaItem.findFirst({
      where: { id, ...ownedMediaFilter(request.user!.id) },
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

    // Without this check the route was a generic Drive proxy: any file readable
    // under the app's OAuth grant could be fetched by ID, and 200-vs-404 leaked
    // whether an arbitrary file ID existed. Only IDs this library actually
    // references as artwork are servable.
    const isKnownAsset = await fastify.prisma.mediaItem.findFirst({
      where: {
        OR: [{ posterDriveFileId: driveFileId }, { backdropDriveFileId: driveFileId }],
      },
      select: { id: true },
    });

    if (!isKnownAsset) {
      return reply.status(404).send({
        error: {
          code: 'ASSET_NOT_FOUND',
          message: 'Görsel yüklenemedi.',
          requestId: request.id,
        },
      });
    }

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

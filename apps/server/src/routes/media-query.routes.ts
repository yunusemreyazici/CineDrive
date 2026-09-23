import type { FastifyPluginAsync } from 'fastify';
import { mediaQuerySchema } from '@cinedrive/shared';
import type { Prisma } from '@cinedrive/prisma';
import { buildPlaybackPlan } from '../services/playback-plan.service.js';
import { ownedLibraryFilter, ownedMediaFilter } from '../utils/library-access.js';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const quoteFtsPhrase = (value: string) => `"${value.replaceAll('"', '""')}"`;

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

const safeSubtitleDriveFileSelect = {
  id: true,
  googleDriveFileId: true,
} satisfies Prisma.DriveFileSelect;

const safeSubtitleSelect = {
  id: true,
  language: true,
  label: true,
  isForced: true,
  isHearingImpaired: true,
  isDefault: true,
  sourceFormat: true,
  mediaItemId: true,
  episodeId: true,
  driveFileId: true,
  driveFile: { select: safeSubtitleDriveFileSelect },
} satisfies Prisma.SubtitleTrackSelect;

const subtitleUrl = (driveFile: { id: string; googleDriveFileId: string | null }) =>
  `/api/media/${driveFile.googleDriveFileId || driveFile.id}/subtitle`;

const safeSubtitleWithUrl = (subtitle: {
  id: string;
  language: string;
  label: string | null;
  isForced: boolean;
  isHearingImpaired: boolean;
  isDefault: boolean;
  driveFile: { id: string; googleDriveFileId: string | null };
}) => ({
  id: subtitle.id,
  languageCode: subtitle.language,
  languageLabel: subtitle.label || subtitle.language.toUpperCase(),
  forced: subtitle.isForced,
  hearingImpaired: subtitle.isHearingImpaired,
  isDefault: subtitle.isDefault,
  url: subtitleUrl(subtitle.driveFile),
});

export const mediaQueryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/media: Filter & Search Media Items
  fastify.get('/', async (request, reply) => {
    const parseResult = mediaQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Medya listeleme parametreleri geçersiz.',
          requestId: request.id,
          details: parseResult.error.format(),
        },
      });
    }

    const {
      type,
      genre,
      person,
      year,
      yearFrom,
      yearTo,
      minRating,
      search,
      hideWithoutMetadata,
      sortBy,
      sortOrder,
      page,
      limit,
    } = parseResult.data;

    /*
     * Every list request now starts from the caller's own libraries. Until
     * `MediaItem.libraryId` existed there was no cheap way to express this, and
     * the endpoint simply returned every media row in the database — favourites
     * and progress were scoped to the user, the catalogue itself was not.
     */
    const where: Prisma.MediaItemWhereInput = { ...ownedMediaFilter(request.user!.id) };
    if (type) where.type = type;
    const ftsParts: string[] = [];
    if (genre && genre.trim().length >= 3) {
      ftsParts.push(`genres : ${quoteFtsPhrase(genre.trim())}`);
    }
    if (person && person.trim().length >= 3) {
      ftsParts.push(`cast : ${quoteFtsPhrase(person.trim())}`);
    }

    if (genre && genre.trim().length < 3) where.genres = { contains: genre };
    if (person && person.trim().length < 3) where.cast = { contains: person };

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

    if (search?.trim()) {
      if (search.trim().length < 3) {
        where.OR = [
          { title: { contains: search } },
          { normalizedTitle: { contains: search.toLowerCase() } },
          { cast: { contains: search } },
        ];
      } else {
        const phrase = quoteFtsPhrase(search.trim());
        ftsParts.push(`(title : ${phrase} OR normalizedTitle : ${phrase} OR cast : ${phrase})`);
      }
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
    let items: Prisma.MediaItemGetPayload<{ select: typeof listItemSelect }>[];
    let total: number;
    if (ftsParts.length > 0) {
      const shortSearch = search?.trim() && search.trim().length < 3 ? search.trim() : null;
      const shortGenre = genre && genre.trim().length < 3 ? genre : null;
      const shortPerson = person && person.trim().length < 3 ? person : null;
      const rangeYearFrom = year ? null : yearFrom || null;
      const rangeYearTo = year ? null : yearTo || null;
      const whereSql = `
        FROM "MediaItem" AS m
        INNER JOIN "MediaItemSearch" ON "MediaItemSearch".rowid = m.rowid
        INNER JOIN "Library" AS l ON l.id = m.libraryId
        WHERE "MediaItemSearch" MATCH ?
          AND (l.userId = ? OR EXISTS (
            SELECT 1 FROM "LibraryMembership" AS lm
            WHERE lm.libraryId = m.libraryId AND lm.userId = ?
          ))
          AND (? IS NULL OR m.type = ?)
          AND (? IS NULL OR instr(lower(COALESCE(m.genres, '')), lower(?)) > 0)
          AND (? IS NULL OR instr(lower(COALESCE(m.cast, '')), lower(?)) > 0)
          AND (? IS NULL OR m.year = ?)
          AND (? IS NULL OR m.year >= ?)
          AND (? IS NULL OR m.year <= ?)
          AND (? IS NULL OR m.voteAverage >= ?)
          AND (? IS NULL OR instr(lower(m.title), lower(?)) > 0
            OR instr(lower(m.normalizedTitle), lower(?)) > 0
            OR instr(lower(COALESCE(m.cast, '')), lower(?)) > 0)
          AND (? = 0 OR m.type = 'series' OR m.tmdbId IS NOT NULL)
      `;
      const queryParams: Array<string | number | null> = [
        ftsParts.join(' AND '),
        request.user!.id,
        request.user!.id,
        type || null,
        type || null,
        shortGenre,
        shortGenre,
        shortPerson,
        shortPerson,
        year || null,
        year || null,
        rangeYearFrom,
        rangeYearFrom,
        rangeYearTo,
        rangeYearTo,
        minRating || null,
        minRating || null,
        shortSearch,
        shortSearch,
        shortSearch,
        shortSearch,
        hideWithoutMetadata ? 1 : 0,
      ];
      const [countRows, idRows] = await Promise.all([
        fastify.prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
          `SELECT COUNT(DISTINCT m.id) AS total ${whereSql}`,
          ...queryParams,
        ),
        fastify.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT DISTINCT m.id ${whereSql}
           ORDER BY m."${sortBy}" ${sortOrder.toUpperCase()}, m.id ASC
           LIMIT ? OFFSET ?`,
          ...queryParams,
          limit,
          skip,
        ),
      ]);
      total = Number(countRows[0]?.total || 0);
      const pageIds = idRows.map((row) => row.id);
      const rows = pageIds.length
        ? await fastify.prisma.mediaItem.findMany({
            where: { ...where, id: { in: pageIds } },
            select: listItemSelect,
          })
        : [];
      const itemsById = new Map(rows.map((row) => [row.id, row]));
      items = pageIds.flatMap((id) => {
        const item = itemsById.get(id);
        return item ? [item] : [];
      });
    } else {
      [items, total] = await Promise.all([
        fastify.prisma.mediaItem.findMany({
          where,
          select: listItemSelect,
          orderBy: { [sortBy]: sortOrder },
          skip,
          take: limit,
        }),
        fastify.prisma.mediaItem.count({ where }),
      ]);
    }

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
        orderBy: { lastPlayedAt: 'desc' },
      }),
    ]);

    const favoriteSet = new Set(favorites.map((f) => f.mediaItemId));
    // The query is newest-first. Map's constructor would overwrite each
    // media's first row with the oldest episode, so keep the first occurrence.
    const progressMap = new Map<string, (typeof progressList)[number]>();
    for (const progress of progressList) {
      if (!progressMap.has(progress.mediaItemId)) {
        progressMap.set(progress.mediaItemId, progress);
      }
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      genres: safeJsonParse<string[]>(item.genres, []),
      isFavorite: favoriteSet.has(item.id),
      progress: progressMap.get(item.id) || null,
      posterUrl: item.posterDriveFileId
        ? `/api/media/assets/${item.posterDriveFileId}`
        : item.posterUrl || null,
      backdropUrl: item.backdropDriveFileId
        ? `/api/media/assets/${item.backdropDriveFileId}`
        : item.backdropUrl || null,
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
        orderBy: { lastPlayedAt: 'desc' },
      });

      const enrichedMedia = {
        ...media,
        genres: safeJsonParse<string[]>(media.genres, []),
        cast: safeJsonParse<Array<{ name: string; character?: string; profileUrl?: string }>>(
          media.cast,
          [],
        ),
        isFavorite: !!isFavorite,
        progress: progress || null,
        posterUrl: media.posterDriveFileId
          ? `/api/media/assets/${media.posterDriveFileId}`
          : media.posterUrl || null,
        backdropUrl: media.backdropDriveFileId
          ? `/api/media/assets/${media.backdropDriveFileId}`
          : media.backdropUrl || null,
      };

      return reply.status(200).send({ media: enrichedMedia });
    },
  );

  // GET /api/media/:id: Detail View
  fastify.get<{ Params: { id: string }; Querystring: { includeEpisodes?: string } }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user!.id;
      const includeEpisodes = request.query.includeEpisodes !== 'false';

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
              seasons: includeEpisodes
                ? {
                    orderBy: { seasonNumber: 'asc' },
                    include: {
                      episodes: {
                        orderBy: { episodeNumber: 'asc' },
                        include: {
                          driveFile: { select: technicalMetadataSelect },
                          subtitles: { select: safeSubtitleSelect },
                          playbackProgresses: {
                            where: { userId },
                            orderBy: { lastPlayedAt: 'desc' },
                          },
                        },
                      },
                    },
                  }
                : {
                    orderBy: { seasonNumber: 'asc' },
                    select: { id: true, seriesId: true, seasonNumber: true, name: true },
                  },
            },
          },
          subtitles: {
            select: safeSubtitleSelect,
          },
          playbackProgresses: {
            where: { userId },
            orderBy: { lastPlayedAt: 'desc' },
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

      const formattedSubtitles = item.subtitles.map(safeSubtitleWithUrl);

      const formattedSeries = item.series
        ? {
            ...item.series,
            seasons: item.series.seasons.map((season) => {
              if (!('episodes' in season)) return season;
              return {
                ...season,
                episodes: season.episodes.map((ep) => {
                  const { driveFile, ...episode } = ep;
                  return {
                    ...episode,
                    technicalMetadata: driveFile,
                    playbackPlan: buildPlaybackPlan(driveFile),
                    subtitles: ep.subtitles.map(safeSubtitleWithUrl),
                  };
                }),
              };
            }),
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
          cast: safeJsonParse<Array<{ name: string; character?: string; profileUrl?: string }>>(
            item.cast,
            [],
          ),
          isFavorite: item.favorites.length > 0,
          progress: item.playbackProgresses[0] || null,
          posterUrl: item.posterDriveFileId
            ? `/api/media/assets/${item.posterDriveFileId}`
            : item.posterUrl || null,
          backdropUrl: item.backdropDriveFileId
            ? `/api/media/assets/${item.backdropDriveFileId}`
            : item.backdropUrl || null,
          subtitles: formattedSubtitles,
          movie: formattedMovie,
          series: formattedSeries,
        },
      });
    },
  );

  // GET /api/series/:id/seasons
  fastify.get<{ Params: { id: string } }>('/series/:id/seasons', async (request, reply) => {
    const { id } = request.params;
    const seasons = await fastify.prisma.season.findMany({
      where: {
        seriesId: id,
        series: { mediaItem: ownedMediaFilter(request.user!.id) },
      },
      orderBy: { seasonNumber: 'asc' },
      include: {
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          include: {
            subtitles: {
              select: safeSubtitleSelect,
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
      where: {
        seasonId: id,
        season: { series: { mediaItem: ownedMediaFilter(request.user!.id) } },
      },
      orderBy: { episodeNumber: 'asc' },
      include: {
        subtitles: {
          select: safeSubtitleSelect,
        },
        playbackProgresses: {
          where: { userId: request.user!.id },
          orderBy: { lastPlayedAt: 'desc' },
        },
      },
    });

    const formattedEpisodes = episodes.map((ep) => ({
      ...ep,
      subtitles: ep.subtitles.map(safeSubtitleWithUrl),
    }));

    return reply.status(200).send({ episodes: formattedEpisodes });
  });

  // GET /api/assets/:driveFileId: Serve image asset
  fastify.get<{ Params: { driveFileId: string } }>(
    '/assets/:driveFileId',
    async (request, reply) => {
      const { driveFileId } = request.params;
      const userId = request.user!.id;

      // Without this check the route was a generic Drive proxy: any file readable
      // under the app's OAuth grant could be fetched by ID, and 200-vs-404 leaked
      // whether an arbitrary file ID existed. Only IDs this library actually
      // references as artwork are servable.
      const isKnownAsset = await fastify.prisma.mediaItem.findFirst({
        where: {
          ...ownedMediaFilter(userId),
          OR: [{ posterDriveFileId: driveFileId }, { backdropDriveFileId: driveFileId }],
        },
        select: {
          id: true,
          library: { select: { userId: true, googleConnectionId: true } },
        },
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
        // Artwork metadata historically stored the Google id directly, while
        // newer scan rows also have a DriveFile record. Prefer the record so a
        // shared library uses its owner's connection rather than the viewer's
        // default account; fall back to the library owner for legacy artwork.
        const assetDriveFile = await fastify.prisma.driveFile.findFirst({
          where: {
            OR: [{ id: driveFileId }, { googleDriveFileId: driveFileId }],
            status: 'active',
            library: ownedLibraryFilter(userId),
          },
          include: { library: true },
        });
        const accessToken = assetDriveFile
          ? (await fastify.driveAccessService.getAccess(userId, assetDriveFile)).accessToken
          : await fastify.googleOAuthService.getValidAccessToken(
              isKnownAsset.library?.userId || userId,
              isKnownAsset.library?.googleConnectionId || undefined,
            );
        const driveStreamRes = await fastify.driveService.createMediaStream(
          accessToken,
          assetDriveFile?.googleDriveFileId || driveFileId,
        );

        reply.status(200);
        if (driveStreamRes.headers['content-type']) {
          reply.header('Content-Type', driveStreamRes.headers['content-type']);
        }
        // The URL is protected by the session cookie and the underlying asset
        // belongs to a user-scoped library. A shared/public cache would let one
        // viewer reuse another viewer's authenticated response.
        reply.header('Cache-Control', 'private, max-age=86400');

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
    },
  );
};

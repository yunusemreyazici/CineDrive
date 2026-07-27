import type { FastifyPluginAsync } from 'fastify';
import { ownedMediaFilter } from '../utils/library-access.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export const subtitleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/media/:subtitleDriveFileId/subtitle
  fastify.get<{ Params: { subtitleDriveFileId: string } }>(
    '/:subtitleDriveFileId/subtitle',
    async (request, reply) => {
      const { subtitleDriveFileId } = request.params;
      const userId = request.user!.id;

      try {
        const vttContent = await fastify.subtitleService.getSubtitleWebVTT(
          userId,
          subtitleDriveFileId,
        );

        reply.status(200);
        reply.header('Content-Type', 'text/vtt; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=86400');

        return reply.send(vttContent);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === 'SUBTITLE_NOT_FOUND') {
          return reply.status(404).send({
            error: {
              code: 'SUBTITLE_NOT_FOUND',
              message: 'Altyazı dosyası veritabanında bulunamadı veya erişim yetkiniz yok.',
              requestId: request.id,
            },
          });
        }

        if (message === 'SUBTITLE_FILE_TOO_LARGE') {
          return reply.status(400).send({
            error: {
              code: 'SUBTITLE_FILE_TOO_LARGE',
              message: 'Altyazı dosyası izin verilen maksimum boyutu (5 MB) aşıyor.',
              requestId: request.id,
            },
          });
        }

        fastify.log.error({ err, requestId: request.id }, 'Subtitle retrieval failed');
        throw err;
      }
    },
  );

  // GET /api/media/subtitles/opensubtitles/search
  fastify.get<{
    Querystring: {
      mediaId: string;
      seasonNumber?: string;
      episodeNumber?: string;
      languages?: string;
    };
  }>('/subtitles/opensubtitles/search', async (request, reply) => {
    const { mediaId, seasonNumber, episodeNumber, languages } = request.query;
    const userId = request.user!.id;

    if (!mediaId) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'mediaId parametresi zorunludur.',
          requestId: request.id,
        },
      });
    }

    /*
     * Every media lookup in this file addressed the row by id alone. Attaching
     * or downloading a subtitle for someone else's title was a matter of
     * knowing the id — and ids are derived from the title. The download path
     * also spends the caller's OpenSubtitles quota, so it was usable against
     * another account's key.
     */
    const [mediaItem, user] = await Promise.all([
      fastify.prisma.mediaItem.findFirst({
        where: { id: mediaId, ...ownedMediaFilter(userId) },
      }),
      fastify.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!mediaItem) {
      return reply.status(404).send({
        error: {
          code: 'MEDIA_NOT_FOUND',
          message: 'Medya içeriği bulunamadı.',
          requestId: request.id,
        },
      });
    }

    const parseOptionalInteger = (value?: string) => {
      if (value === undefined || !/^\d+$/.test(value)) return undefined;
      return Number.parseInt(value, 10);
    };
    const seasonNum = parseOptionalInteger(seasonNumber);
    const episodeNum = parseOptionalInteger(episodeNumber);
    if (
      (seasonNumber !== undefined && seasonNum === undefined) ||
      (episodeNumber !== undefined && episodeNum === undefined)
    ) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Sezon ve bölüm numaraları geçerli tam sayılar olmalıdır.',
          requestId: request.id,
        },
      });
    }

    const userLangs = user?.preferredLanguages?.split(',') || ['tr', 'en'];
    const langList = (languages ? languages.split(',') : userLangs)
      .map((language) => language.trim().toLowerCase())
      .filter((language) => /^[a-z]{2,3}$/.test(language));

    const { OpenSubtitlesService } = await import('../services/opensubtitles.service.js');
    const openSubtitlesService = new OpenSubtitlesService();

    const result = await openSubtitlesService.searchSubtitles(
      mediaItem.title,
      seasonNum,
      episodeNum,
      langList,
      user?.opensubtitlesApiKey || undefined,
      {
        tmdbId: mediaItem.tmdbId,
        imdbId: mediaItem.imdbId,
      },
    );

    return reply.status(200).send(result);
  });

  // POST /api/media/subtitles/opensubtitles/download
  fastify.post<{
    Body: {
      fileId?: number | string;
      mediaId?: string;
      episodeId?: string;
      label?: string;
      languageCode?: string;
    };
  }>('/subtitles/opensubtitles/download', async (request, reply) => {
    const { fileId, mediaId, episodeId, label, languageCode = 'tr' } = request.body;
    const userId = request.user!.id;

    const numericFileId = typeof fileId === 'number' ? fileId : Number(fileId);
    if (!Number.isSafeInteger(numericFileId) || numericFileId <= 0) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Geçerli bir fileId gereklidir.',
          requestId: request.id,
        },
      });
    }

    try {
      const [user, mediaItem, targetEpisode] = await Promise.all([
        fastify.prisma.user.findUnique({ where: { id: userId } }),
        mediaId
          ? fastify.prisma.mediaItem.findFirst({
              where: { id: mediaId, ...ownedMediaFilter(userId) },
              include: { movie: true },
            })
          : null,
        episodeId
          ? fastify.prisma.episode.findFirst({
              where: {
                id: episodeId,
                ...(mediaId ? { mediaItemId: mediaId } : {}),
                mediaItem: ownedMediaFilter(userId),
              },
            })
          : null,
      ]);

      if (
        !mediaId ||
        !mediaItem ||
        (episodeId && !targetEpisode) ||
        (mediaItem.type === 'series' && !targetEpisode)
      ) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_NOT_FOUND',
            message: 'Altyazının bağlanacağı medya veya bölüm bulunamadı.',
            requestId: request.id,
          },
        });
      }

      const sourceDriveFileId = targetEpisode?.driveFileId || mediaItem.movie?.driveFileId;
      const sourceDriveFile = sourceDriveFileId
        ? await fastify.prisma.driveFile.findUnique({ where: { id: sourceDriveFileId } })
        : null;
      if (!sourceDriveFile) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_FILE_NOT_FOUND',
            message: 'Altyazının bağlanacağı video dosyası bulunamadı.',
            requestId: request.id,
          },
        });
      }

      const { OpenSubtitlesService } = await import('../services/opensubtitles.service.js');
      const openSubtitlesService = new OpenSubtitlesService();

      const vttContent = await openSubtitlesService.downloadAndConvertSubtitle(
        numericFileId,
        user?.opensubtitlesApiKey || undefined,
      );

      const subtitleOwnerId = targetEpisode?.id || mediaItem.id;
      const syntheticDriveFileId = `opensub_${numericFileId}_${subtitleOwnerId}`;
      const safeLabel =
        label?.trim().slice(0, 200) || `${languageCode.toUpperCase()} (OpenSubtitles)`;
      const safeLanguage = /^[a-z]{2,3}$/i.test(languageCode) ? languageCode.toLowerCase() : 'tr';

      const driveFile = await fastify.prisma.driveFile.upsert({
        where: { googleDriveFileId: syntheticDriveFileId },
        update: {
          size: BigInt(Buffer.byteLength(vttContent, 'utf-8')),
          status: 'active',
        },
        create: {
          googleDriveFileId: syntheticDriveFileId,
          libraryId: sourceDriveFile.libraryId,
          storageType: 'local',
          name: `${syntheticDriveFileId}.vtt`,
          mimeType: 'text/vtt',
          size: BigInt(Buffer.byteLength(vttContent, 'utf-8')),
          status: 'active',
        },
      });

      const subtitleTrack = await fastify.prisma.subtitleTrack.upsert({
        where: { driveFileId: driveFile.id },
        update: {
          language: safeLanguage,
          label: safeLabel,
          mediaItemId: targetEpisode ? null : mediaItem.id,
          episodeId: targetEpisode?.id || null,
        },
        create: {
          mediaItemId: targetEpisode ? undefined : mediaItem.id,
          episodeId: targetEpisode?.id,
          driveFileId: driveFile.id,
          language: safeLanguage,
          label: safeLabel,
          sourceFormat: 'vtt',
        },
      });

      const cacheDir = path.resolve(process.cwd(), 'data', 'subtitle_cache');
      await fs.mkdir(cacheDir, { recursive: true });
      const cacheHash = crypto
        .createHash('sha256')
        .update(`${syntheticDriveFileId}_1970_nochecksum_v2`)
        .digest('hex');
      const cacheFilePath = path.join(cacheDir, `${cacheHash}.vtt`);
      await fs.writeFile(cacheFilePath, vttContent, 'utf-8');
      await fastify.prisma.driveFile.update({
        where: { id: driveFile.id },
        data: { localFilePath: cacheFilePath },
      });

      return reply.status(200).send({
        subtitleTrack: {
          id: subtitleTrack.id,
          language: subtitleTrack.language,
          label: subtitleTrack.label || subtitleTrack.language.toUpperCase(),
          isForced: subtitleTrack.isForced,
          isHearingImpaired: subtitleTrack.isHearingImpaired,
          isDefault: subtitleTrack.isDefault,
          url: `/api/media/${syntheticDriveFileId}/subtitle`,
        },
        vttContent,
      });
    } catch (err: unknown) {
      fastify.log.error({ err, requestId: request.id }, 'OpenSubtitles download failed');
      return reply.status(500).send({
        error: {
          code: 'OPENSUBTITLES_DOWNLOAD_ERROR',
          message: 'Altyazı indirilirken veya dönüştürülürken hata oluştu.',
          requestId: request.id,
        },
      });
    }
  });

  // POST /api/media/:mediaId/auto-subtitle: Search, download and attach OpenSubtitles track to MediaItem
  fastify.post<{
    Params: { mediaId: string };
    Body: {
      seasonNumber?: number;
      episodeNumber?: number;
      language?: string;
    };
  }>('/:mediaId/auto-subtitle', async (request, reply) => {
    const { mediaId } = request.params;
    const { seasonNumber, episodeNumber, language } = request.body || {};
    const userId = request.user!.id;

    const [mediaItem, user] = await Promise.all([
      fastify.prisma.mediaItem.findFirst({
        where: { id: mediaId, ...ownedMediaFilter(userId) },
        include: {
          movie: true,
          episodes: {
            where:
              seasonNumber !== undefined && episodeNumber !== undefined
                ? { seasonNumber, episodeNumber }
                : undefined,
            take: 1,
            include: { driveFile: true },
          },
        },
      }),
      fastify.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    const targetEpisode =
      seasonNumber !== undefined && episodeNumber !== undefined
        ? mediaItem?.episodes[0]
        : undefined;
    const sourceDriveFileId = targetEpisode?.driveFileId || mediaItem?.movie?.driveFileId;
    const sourceDriveFile = sourceDriveFileId
      ? await fastify.prisma.driveFile.findUnique({ where: { id: sourceDriveFileId } })
      : null;

    if (!mediaItem || !sourceDriveFile) {
      return reply.status(404).send({
        error: {
          code: 'MEDIA_NOT_FOUND',
          message: 'Medya içeriği, bölümü veya bağlı kütüphanesi bulunamadı.',
          requestId: request.id,
        },
      });
    }

    const { OpenSubtitlesService } = await import('../services/opensubtitles.service.js');
    const openSubtitlesService = new OpenSubtitlesService();

    /*
     * The button used to ask for Turkish and nothing else — the request sent no
     * language, and both the client hook and this route defaulted to 'tr'. The
     * account's own subtitle language preference was never consulted, so an
     * English-only title simply reported "no subtitle found".
     */
    const preferredLanguages = language
      ? [language]
      : (user?.preferredLanguages || 'tr,en')
          .split(',')
          .map((code) => code.trim().toLowerCase())
          .filter(Boolean);

    let topSub: { fileId: number; filename: string; languageName: string; languageCode: string } | undefined;

    // Tried in preference order rather than all at once, so the first choice
    // wins whenever it exists instead of losing to a more-downloaded track in
    // another language.
    for (const candidate of preferredLanguages) {
      const searchRes = await openSubtitlesService.searchSubtitles(
        mediaItem.title,
        seasonNumber,
        episodeNumber,
        [candidate],
        user?.opensubtitlesApiKey || undefined,
        {
          tmdbId: mediaItem.tmdbId,
          imdbId: mediaItem.imdbId,
        },
      );

      if (searchRes.results?.[0]) {
        topSub = searchRes.results[0];
        break;
      }
    }

    if (!topSub) {
      return reply.status(404).send({
        error: {
          code: 'NO_SUBTITLE_FOUND',
          message: `${preferredLanguages.join(', ').toUpperCase()} dillerinde uygun altyazı bulunamadı.`,
          requestId: request.id,
        },
      });
    }

    const vttContent = await openSubtitlesService.downloadAndConvertSubtitle(
      topSub.fileId,
      user?.opensubtitlesApiKey || undefined,
    );

    const subtitleOwnerId = targetEpisode?.id || mediaItem.id;
    const syntheticDriveFileId = `opensub_${topSub.fileId}_${subtitleOwnerId}`;

    let driveFile = await fastify.prisma.driveFile.findFirst({
      where: { googleDriveFileId: syntheticDriveFileId },
    });

    if (!driveFile) {
      driveFile = await fastify.prisma.driveFile.create({
        data: {
          googleDriveFileId: syntheticDriveFileId,
          libraryId: sourceDriveFile.libraryId,
          storageType: 'local',
          name: `${topSub.filename}.vtt`,
          mimeType: 'text/vtt',
          size: BigInt(Buffer.byteLength(vttContent, 'utf-8')),
          status: 'active',
        },
      });
    }

    let subtitleTrack = await fastify.prisma.subtitleTrack.findUnique({
      where: { driveFileId: driveFile.id },
    });

    if (!subtitleTrack) {
      subtitleTrack = await fastify.prisma.subtitleTrack.create({
        data: {
          mediaItemId: targetEpisode ? undefined : mediaItem.id,
          episodeId: targetEpisode?.id,
          driveFileId: driveFile.id,
          language: topSub.languageCode,
          label: `${topSub.languageName} (OpenSubtitles)`,
          sourceFormat: 'vtt',
        },
      });
    }

    const CACHE_DIR = path.resolve(process.cwd(), 'data', 'subtitle_cache');
    await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

    const cacheHash = crypto
      .createHash('sha256')
      .update(`${syntheticDriveFileId}_1970_nochecksum_v2`)
      .digest('hex');

    const cacheFilePath = path.join(CACHE_DIR, `${cacheHash}.vtt`);
    await fs.writeFile(cacheFilePath, vttContent, 'utf-8').catch(() => {});
    await fastify.prisma.driveFile.update({
      where: { id: driveFile.id },
      data: { localFilePath: cacheFilePath },
    });

    return reply.status(200).send({
      message: 'Altyazı başarıyla indirildi ve veritabanına kaydedildi.',
      subtitleTrack,
    });
  });
};

import type { FastifyPluginAsync } from 'fastify';
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

    const [mediaItem, user] = await Promise.all([
      fastify.prisma.mediaItem.findUnique({ where: { id: mediaId } }),
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

    const seasonNum = seasonNumber ? parseInt(seasonNumber, 10) : undefined;
    const episodeNum = episodeNumber ? parseInt(episodeNumber, 10) : undefined;
    const userLangs = user?.preferredLanguages ? user.preferredLanguages.split(',') : ['tr', 'en'];
    const langList = languages ? languages.split(',') : userLangs;

    const { OpenSubtitlesService } = await import('../services/opensubtitles.service.js');
    const openSubtitlesService = new OpenSubtitlesService();

    const result = await openSubtitlesService.searchSubtitles(
      mediaItem.title,
      seasonNum,
      episodeNum,
      langList,
      user?.opensubtitlesApiKey || undefined,
    );

    return reply.status(200).send(result);
  });

  // POST /api/media/subtitles/opensubtitles/download
  fastify.post<{
    Body: {
      fileId?: number | string;
      downloadUrl?: string;
    };
  }>('/subtitles/opensubtitles/download', async (request, reply) => {
    const { fileId, downloadUrl } = request.body;
    const userId = request.user!.id;

    const targetId = fileId || downloadUrl;
    if (!targetId) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'fileId veya downloadUrl parametresi gereklidir.',
          requestId: request.id,
        },
      });
    }

    try {
      const user = await fastify.prisma.user.findUnique({ where: { id: userId } });
      const { OpenSubtitlesService } = await import('../services/opensubtitles.service.js');
      const openSubtitlesService = new OpenSubtitlesService();

      const vttContent = await openSubtitlesService.downloadAndConvertSubtitle(
        targetId,
        user?.opensubtitlesApiKey || undefined,
      );

      reply.status(200);
      reply.header('Content-Type', 'text/vtt; charset=utf-8');
      return reply.send(vttContent);
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
    const { seasonNumber, episodeNumber, language = 'tr' } = request.body || {};
    const userId = request.user!.id;

    const [mediaItem, user, library] = await Promise.all([
      fastify.prisma.mediaItem.findUnique({
        where: { id: mediaId },
      }),
      fastify.prisma.user.findUnique({ where: { id: userId } }),
      fastify.prisma.library.findFirst(),
    ]);

    if (!mediaItem || !library) {
      return reply.status(404).send({
        error: {
          code: 'MEDIA_NOT_FOUND',
          message: 'Medya içeriği veya kütüphane bulunamadı.',
          requestId: request.id,
        },
      });
    }

    const { OpenSubtitlesService } = await import('../services/opensubtitles.service.js');
    const openSubtitlesService = new OpenSubtitlesService();

    const searchRes = await openSubtitlesService.searchSubtitles(
      mediaItem.title,
      seasonNumber,
      episodeNumber,
      [language],
      user?.opensubtitlesApiKey || undefined,
    );

    if (!searchRes.results || searchRes.results.length === 0 || !searchRes.results[0]) {
      return reply.status(404).send({
        error: {
          code: 'NO_SUBTITLE_FOUND',
          message: `${language.toUpperCase()} dilinde uygun altyazı bulunamadı.`,
          requestId: request.id,
        },
      });
    }

    const topSub = searchRes.results[0];

    const vttContent = await openSubtitlesService.downloadAndConvertSubtitle(
      topSub.fileId,
      user?.opensubtitlesApiKey || undefined,
    );

    const syntheticDriveFileId = `opensub_${topSub.fileId}`;

    let driveFile = await fastify.prisma.driveFile.findFirst({
      where: { googleDriveFileId: syntheticDriveFileId },
    });

    if (!driveFile) {
      driveFile = await fastify.prisma.driveFile.create({
        data: {
          googleDriveFileId: syntheticDriveFileId,
          libraryId: library.id,
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
          mediaItemId: mediaItem.id,
          driveFileId: driveFile.id,
          language: topSub.languageCode || language,
          label: `${topSub.languageName} (OpenSubtitles)`,
          sourceFormat: 'vtt',
        },
      });
    }

    const CACHE_DIR = path.resolve(process.cwd(), 'data', 'subtitle_cache');
    await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});

    const cacheHash = crypto
      .createHash('sha256')
      .update(`${syntheticDriveFileId}_1970_nochecksum_v1`)
      .digest('hex');

    const cacheFilePath = path.join(CACHE_DIR, `${cacheHash}.vtt`);
    await fs.writeFile(cacheFilePath, vttContent, 'utf-8').catch(() => {});

    return reply.status(200).send({
      message: 'Altyazı başarıyla indirildi ve veritabanına kaydedildi.',
      subtitleTrack,
    });
  });
};

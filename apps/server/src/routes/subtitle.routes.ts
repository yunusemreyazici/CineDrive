import type { FastifyPluginAsync } from 'fastify';

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
};

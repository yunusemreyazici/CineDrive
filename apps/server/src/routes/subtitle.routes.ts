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
};

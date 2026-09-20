import type { FastifyPluginAsync } from 'fastify';
import { driveSourceInput, resolveActiveDriveFile } from './shared.js';

/** Scrub-bar thumbnails. */
export const mediaPreviewRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { driveFileId: string };
    Querystring: { time?: string };
  }>('/:driveFileId/preview', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(fastify, request.params.driveFileId, request.user!.id);
    if (!driveFile) {
      return reply.status(404).send({
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'Önizleme oluşturulacak medya dosyası bulunamadı.',
          requestId: request.id,
        },
      });
    }

    const requestedTime = Number(request.query.time || 0);
    const maxTime = driveFile.mediaDuration
      ? Math.max(0, driveFile.mediaDuration - 0.1)
      : 7 * 24 * 60 * 60;
    if (!Number.isFinite(requestedTime) || requestedTime < 0 || requestedTime > maxTime) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PREVIEW_TIME',
          message: 'Geçersiz önizleme zamanı.',
          requestId: request.id,
        },
      });
    }

    let remoteInput: ReturnType<typeof driveSourceInput> | undefined;
    if (driveFile.storageType !== 'local') {
      try {
        // Resolve the credential eagerly, but keep the token out of FFmpeg
        // arguments. The loopback capability endpoint refreshes it per request
        // and prevents secrets from appearing in process listings.
        await fastify.driveAccessService.getAccess(request.user!.id, driveFile);
        remoteInput = driveSourceInput(fastify, driveFile, request.user!.id);
      } catch {
        return reply.status(401).send({
          error: {
            code: 'GOOGLE_AUTH_REQUIRED',
            message: 'Önizleme için Google Drive bağlantısını yenileyin.',
            requestId: request.id,
          },
        });
      }
    }

    try {
      const frame = await fastify.previewService.getFrame({
        driveFileId: driveFile.id,
        localFilePath: driveFile.localFilePath,
        googleDriveFileId: driveFile.googleDriveFileId,
        modifiedTime: driveFile.modifiedTime,
        md5Checksum: driveFile.md5Checksum,
        timeSeconds: requestedTime,
        remoteInput,
      });

      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return reply.send(frame);
    } catch (error) {
      if (error instanceof Error && error.message === 'PREVIEW_CAPACITY_REACHED') {
        reply.header('Retry-After', '1');
        return reply.status(503).send({
          error: {
            code: 'PREVIEW_BUSY',
            message: 'Önizleme hazırlanıyor, kısa süre sonra tekrar deneyin.',
            requestId: request.id,
          },
        });
      }
      throw error;
    }
  });

  // Helper handler for GET and HEAD Range streaming requests
};

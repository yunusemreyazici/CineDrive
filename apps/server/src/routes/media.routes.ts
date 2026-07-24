import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // Helper handler for GET and HEAD Range streaming requests
  const handleStreamRequest = async (
    driveFileId: string,
    userId: string,
    isHeadRequest: boolean,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    // Range validation against malformed, multi-range or amplification attacks
    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      // Reject multi-range requests (comma separated)
      if (rangeHeader.includes(',')) {
        return reply.status(400).send({
          error: {
            code: 'MULTI_RANGE_NOT_SUPPORTED',
            message: 'Çoklu Range istekleri desteklenmemektedir.',
            requestId: request.id,
          },
        });
      }

      // Check range syntax regex (e.g. bytes=0-1000 or bytes=1000-)
      const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (!rangeMatch) {
        return reply.status(416).send({
          error: {
            code: 'RANGE_NOT_SATISFIABLE',
            message: 'Geçersiz Range başlığı biçimi.',
            requestId: request.id,
          },
        });
      }

      const startStr = rangeMatch[1];
      const endStr = rangeMatch[2];
      if (startStr && endStr) {
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (start > end) {
          return reply.status(416).send({
            error: {
              code: 'RANGE_NOT_SATISFIABLE',
              message: 'Başlangıç pozisyonu bitiş pozisyonundan büyük olamaz.',
              requestId: request.id,
            },
          });
        }
      }
    }

    // 1. Verify file exists in database and belongs to an active library
    let driveFile = await fastify.prisma.driveFile.findFirst({
      where: {
        OR: [{ googleDriveFileId: driveFileId }, { id: driveFileId }],
        status: 'active',
      },
      include: { library: true },
    });

    if (!driveFile) {
      // Fallback 1: Is driveFileId a MediaItem ID (for movies)?
      const movieItem = await fastify.prisma.movie.findFirst({
        where: { mediaItemId: driveFileId },
      });
      if (movieItem?.driveFileId) {
        driveFile = await fastify.prisma.driveFile.findFirst({
          where: { id: movieItem.driveFileId, status: 'active' },
          include: { library: true },
        });
      }
    }

    if (!driveFile) {
      // Fallback 2: Is driveFileId an Episode ID?
      const episodeItem = await fastify.prisma.episode.findFirst({
        where: { id: driveFileId },
      });
      if (episodeItem?.driveFileId) {
        driveFile = await fastify.prisma.driveFile.findFirst({
          where: { id: episodeItem.driveFileId, status: 'active' },
          include: { library: true },
        });
      }
    }

    if (!driveFile) {
      return reply.status(404).send({
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'Medya dosyası veritabanında bulunamadı veya erişim yetkiniz yok.',
          requestId: request.id,
        },
      });
    }

    // 2. Validate video MIME type or extension
    const isVideo =
      driveFile.mimeType.startsWith('video/') ||
      driveFile.mimeType === 'application/octet-stream' ||
      driveFile.mimeType === 'application/x-matroska' ||
      ['.mp4', '.mkv', '.webm', '.m4v', '.avi', '.mov', '.ts', '.m2ts', '.flv', '.wmv', '.3gp'].some((ext) =>
        driveFile.name.toLowerCase().endsWith(ext),
      );

    if (!isVideo) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_MEDIA_TYPE',
          message: 'İstenen dosya bir video dosyası değil.',
          requestId: request.id,
        },
      });
    }

    // 4. Setup AbortController for client socket disconnect handling
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };

    const cleanupListeners = () => {
      request.raw.removeListener('close', onClientClose);
    };

    request.raw.on('close', onClientClose);
    reply.raw.on('finish', cleanupListeners);
    reply.raw.on('error', cleanupListeners);

    // 3. Get valid Google access token for library connection
    let accessToken: string;
    try {
      accessToken = await fastify.googleOAuthService.getValidAccessToken(
        userId,
        driveFile.library?.googleConnectionId || undefined,
      );
    } catch {
      cleanupListeners();
      return reply.status(401).send({
        error: {
          code: 'GOOGLE_AUTH_REQUIRED',
          message: 'Google Drive erişim izni yenilenemedi. Lütfen Ayarlar sayfasından hesabınızı tekrar bağlayın.',
          requestId: request.id,
        },
      });
    }

    try {
      const driveStreamRes = await fastify.driveService.createMediaStream(
        accessToken,
        driveFile.googleDriveFileId,
        rangeHeader,
        abortController.signal,
      );

      // Handle mid-stream network errors on upstream Google Drive stream
      driveStreamRes.stream.on('error', (streamErr) => {
        cleanupListeners();
        abortController.abort();
        if (!reply.raw.writableEnded) {
          reply.raw.destroy(streamErr);
        }
      });

      // Set HTTP status (206 Partial Content or 200 OK)
      reply.status(driveStreamRes.status);

      // Passthrough Google Drive headers to browser with browser-compatible MIME types
      let contentType = driveStreamRes.headers['content-type'] || driveFile.mimeType;
      if (!contentType || contentType === 'application/octet-stream') {
        const nameLower = driveFile.name.toLowerCase();
        if (nameLower.endsWith('.webm')) contentType = 'video/webm';
        else if (nameLower.endsWith('.mkv')) contentType = 'video/x-matroska';
        else contentType = 'video/mp4';
      }
      reply.header('Content-Type', contentType);
      if (driveStreamRes.headers['content-length']) {
        reply.header('Content-Length', driveStreamRes.headers['content-length']);
      }
      if (driveStreamRes.headers['content-range']) {
        reply.header('Content-Range', driveStreamRes.headers['content-range']);
      }
      if (driveStreamRes.headers['accept-ranges']) {
        reply.header('Accept-Ranges', driveStreamRes.headers['accept-ranges']);
      }
      if (driveStreamRes.headers['etag']) {
        reply.header('ETag', driveStreamRes.headers['etag']);
      }
      if (driveStreamRes.headers['last-modified']) {
        reply.header('Last-Modified', driveStreamRes.headers['last-modified']);
      }

      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');

      if (isHeadRequest) {
        cleanupListeners();
        return reply.send();
      }

      // Stream piping directly to Fastify (Native backpressure & zero RAM/disk buffering)
      return reply.send(driveStreamRes.stream);
    } catch (err: unknown) {
      cleanupListeners();

      if (abortController.signal.aborted) {
        return; // Client closed connection, ignore error silently
      }

      const isRangeUnsatisfiable =
        err &&
        typeof err === 'object' &&
        'code' in err &&
        ((err as { code?: number | string }).code === 416 ||
          (err as { code?: number | string }).code === '416');

      if (isRangeUnsatisfiable) {
        return reply.status(416).send({
          error: {
            code: 'RANGE_NOT_SATISFIABLE',
            message: 'Geçersiz Range isteği.',
            requestId: request.id,
          },
        });
      }

      fastify.log.error({ err, requestId: request.id }, 'Video streaming proxy failed');
      throw err;
    }
  };

  // GET /api/media/:driveFileId/stream
  fastify.get<{ Params: { driveFileId: string } }>(
    '/:driveFileId/stream',
    async (request, reply) => {
      return handleStreamRequest(
        request.params.driveFileId,
        request.user!.id,
        false,
        request,
        reply,
      );
    },
  );

  // HEAD /api/media/:driveFileId/stream
  fastify.head<{ Params: { driveFileId: string } }>(
    '/:driveFileId/stream',
    async (request, reply) => {
      return handleStreamRequest(
        request.params.driveFileId,
        request.user!.id,
        true,
        request,
        reply,
      );
    },
  );
};

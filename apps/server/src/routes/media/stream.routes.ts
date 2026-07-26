import fs from 'node:fs';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { TranscodeQuality } from '../../services/transcode.service.js';
import { resolveRangeRequest } from '../../utils/http-range.js';
import { ownedLibraryFilter } from '../../utils/library-access.js';
import { driveSourceInput, parseHlsSession } from './shared.js';

/** Byte-range and on-the-fly transcode delivery. */
export const mediaStreamRoutes: FastifyPluginAsync = async (fastify) => {
  const handleStreamRequest = async (
    driveFileId: string,
    userId: string,
    isHeadRequest: boolean,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    // Wire client-disconnect handling before any await. Attaching it later left
    // a window where 'close' had already fired, so the listener never ran and
    // FFmpeg was spawned for a client that had already gone away.
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

    // Range syntax validation. Bounds that depend on the resource size are
    // resolved once the file (and therefore its length) is known.
    const rangeHeader = request.headers.range;
    const syntaxCheck = resolveRangeRequest(rangeHeader, null);
    if (syntaxCheck.kind === 'multi') {
      cleanupListeners();
      return reply.status(400).send({
        error: {
          code: 'MULTI_RANGE_NOT_SUPPORTED',
          message: 'Çoklu Range istekleri desteklenmemektedir.',
          requestId: request.id,
        },
      });
    }
    if (syntaxCheck.kind === 'invalid' || syntaxCheck.kind === 'unsatisfiable') {
      cleanupListeners();
      return reply.status(416).send({
        error: {
          code: 'RANGE_NOT_SATISFIABLE',
          message: 'Geçersiz Range başlığı biçimi.',
          requestId: request.id,
        },
      });
    }

    // 1. Verify file exists in database and belongs to a library the caller owns
    const ownedLibrary = ownedLibraryFilter(userId);
    let driveFile = await fastify.prisma.driveFile.findFirst({
      where: {
        OR: [
          { googleDriveFileId: driveFileId },
          { id: driveFileId },
          { localFilePath: driveFileId },
        ],
        status: 'active',
        library: ownedLibrary,
      },
      include: { library: true },
    });

    if (!driveFile) {
      // Fallback 1: Is driveFileId a MediaItem ID (for movies)?
      const movieItem = await fastify.prisma.movie.findFirst({
        where: { mediaItemId: driveFileId },
      });

      if (movieItem && movieItem.driveFileId) {
        driveFile = await fastify.prisma.driveFile.findFirst({
          where: { id: movieItem.driveFileId, status: 'active', library: ownedLibrary },
          include: { library: true },
        });
      }
    }

    if (!driveFile) {
      // Fallback 2: Is driveFileId an Episode ID (for TV series episodes)?
      const episodeItem = await fastify.prisma.episode.findFirst({
        where: { id: driveFileId },
      });

      if (episodeItem && episodeItem.driveFileId) {
        driveFile = await fastify.prisma.driveFile.findFirst({
          where: { id: episodeItem.driveFileId, status: 'active', library: ownedLibrary },
          include: { library: true },
        });
      }
    }

    if (!driveFile) {
      cleanupListeners();
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
      [
        '.mp4',
        '.mkv',
        '.webm',
        '.m4v',
        '.avi',
        '.mov',
        '.ts',
        '.m2ts',
        '.flv',
        '.wmv',
        '.3gp',
      ].some((ext) => driveFile.name.toLowerCase().endsWith(ext));

    if (!isVideo) {
      cleanupListeners();
      return reply.status(400).send({
        error: {
          code: 'INVALID_MEDIA_TYPE',
          message: 'İstenen dosya bir video dosyası değil.',
          requestId: request.id,
        },
      });
    }

    const transcodeMode = (request.query as Record<string, string>)?.transcode;
    const requestedQuality = (request.query as Record<string, string>)?.quality;
    const requestedStart = (request.query as Record<string, string>)?.start;
    const requestedSession = (request.query as Record<string, string>)?.session;
    const ownerSessionId = requestedSession ? parseHlsSession(requestedSession) : undefined;
    if (requestedSession && !ownerSessionId) {
      cleanupListeners();
      return reply.status(400).send({
        error: {
          code: 'INVALID_TRANSCODE_SESSION',
          message: 'Geçersiz transcode oynatma oturumu.',
          requestId: request.id,
        },
      });
    }
    const startSeconds = requestedStart === undefined ? 0 : Number(requestedStart);
    if (!Number.isFinite(startSeconds) || startSeconds < 0) {
      cleanupListeners();
      return reply.status(400).send({
        error: {
          code: 'INVALID_TRANSCODE_START',
          message: 'Geçersiz transcode başlangıç zamanı.',
          requestId: request.id,
        },
      });
    }
    const validQualities = new Set<TranscodeQuality>(['original', '1080p', '720p', '480p']);
    if (requestedQuality && !validQualities.has(requestedQuality as TranscodeQuality)) {
      cleanupListeners();
      return reply.status(400).send({
        error: {
          code: 'INVALID_TRANSCODE_QUALITY',
          message: 'Geçersiz transcode kalite profili.',
          requestId: request.id,
        },
      });
    }
    // The socket may have closed while the database and token lookups above
    // were in flight. Binding the kill switch to the abort signal (rather than
    // to a second 'close' listener) makes that case deterministic.
    const bindTranscodeAbort = (kill: () => void) => {
      abortController.signal.addEventListener(
        'abort',
        () => {
          kill();
          cleanupListeners();
        },
        { once: true },
      );
    };

    const transcodeQuality = (requestedQuality || '1080p') as TranscodeQuality;
    const isTranscode =
      transcodeMode === 'true' ||
      transcodeMode === '1' ||
      transcodeMode === 'audio' ||
      transcodeMode === 'full';
    // A restarted stream must decode from the exact requested timestamp.
    // Copying H.264 would begin at an earlier keyframe and desynchronize audio.
    const shouldTranscodeVideo = transcodeMode === 'full' || startSeconds > 0;

    // 5. Handle Local File Streaming (Direct Disk Stream)
    if (driveFile.storageType === 'local' && driveFile.localFilePath) {
      if (!fs.existsSync(driveFile.localFilePath)) {
        cleanupListeners();
        return reply.status(404).send({
          error: {
            code: 'LOCAL_FILE_NOT_FOUND',
            message: 'Yerel dosya diskte bulunamadı.',
            requestId: request.id,
          },
        });
      }

      if (isTranscode) {
        reply.header('Content-Type', 'video/mp4');
        reply.header('X-Transcode-Quality', transcodeQuality);
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');

        if (isHeadRequest) {
          cleanupListeners();
          return reply.send();
        }

        if (abortController.signal.aborted) {
          cleanupListeners();
          return;
        }

        const { stream: transcodedStream, kill } = fastify.transcodeService.createTranscodedStream(
          // A local MP4 must remain seekable. Feeding it through a ReadStream
          // turns it into a pipe, and FFmpeg cannot revisit MP4 sample offsets.
          driveFile.localFilePath,
          {
            transcodeVideo: shouldTranscodeVideo,
            quality: transcodeQuality,
            startSeconds,
            ...(ownerSessionId ? { ownerSessionId } : {}),
          },
        );
        bindTranscodeAbort(kill);

        return reply.send(transcodedStream);
      }

      const stat = fs.statSync(driveFile.localFilePath);
      const fileSize = stat.size;
      const resolution = resolveRangeRequest(rangeHeader, fileSize);

      if (resolution.kind === 'unsatisfiable' || resolution.kind === 'invalid') {
        cleanupListeners();
        reply.header('Content-Range', `bytes */${fileSize}`);
        return reply.status(416).send({
          error: {
            code: 'RANGE_NOT_SATISFIABLE',
            message: 'İstenen Range aralığı dosya boyutunun dışında.',
            requestId: request.id,
          },
        });
      }

      const start = resolution.kind === 'range' ? resolution.start : 0;
      const end = resolution.kind === 'range' ? resolution.end : Math.max(0, fileSize - 1);
      const statusCode = resolution.kind === 'range' ? 206 : 200;

      const chunkSize = fileSize === 0 ? 0 : end - start + 1;
      let contentType = driveFile.mimeType;
      if (!contentType || contentType === 'application/octet-stream') {
        const nameLower = driveFile.name.toLowerCase();
        if (nameLower.endsWith('.webm')) contentType = 'video/webm';
        else if (nameLower.endsWith('.mkv')) contentType = 'video/x-matroska';
        else contentType = 'video/mp4';
      }

      reply.status(statusCode);
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', chunkSize);
      reply.header('Accept-Ranges', 'bytes');
      if (statusCode === 206) {
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      }

      if (isHeadRequest) {
        cleanupListeners();
        return reply.send();
      }

      const fileStream = fs.createReadStream(driveFile.localFilePath, { start, end });
      return reply.send(fileStream);
    }

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
          message:
            'Google Drive erişim izni yenilenemedi. Lütfen Ayarlar sayfasından hesabınızı tekrar bağlayın.',
          requestId: request.id,
        },
      });
    }

    try {
      if (isTranscode) {
        reply.status(200);
        reply.header('Content-Type', 'video/mp4');
        reply.header('X-Transcode-Quality', transcodeQuality);
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');

        if (isHeadRequest) {
          cleanupListeners();
          return reply.send();
        }

        if (abortController.signal.aborted) {
          cleanupListeners();
          return;
        }

        // Give FFmpeg a seekable HTTP input instead of a Node pipe, so
        // input-side `-ss` can jump near the requested timestamp without
        // downloading and discarding the whole file from byte zero. The URL
        // points at this server's loopback proxy rather than at Google, so a
        // job outliving its access token refreshes instead of failing.
        const source = driveSourceInput(fastify, driveFile, userId);
        const { stream: transcodedStream, kill } = fastify.transcodeService.createTranscodedStream(
          source.url,
          {
            transcodeVideo: shouldTranscodeVideo,
            quality: transcodeQuality,
            startSeconds,
            inputOptions: source.inputOptions,
            ...(ownerSessionId ? { ownerSessionId } : {}),
          },
        );
        bindTranscodeAbort(kill);

        return reply.send(transcodedStream);
      }

      // Now that the file's real length is known, resolve the requested window
      // into absolute bounds: suffix ranges become concrete offsets, and an
      // over-large `bytes=0-<huge>` is narrowed instead of being forwarded.
      const driveFileSize = driveFile.size === null ? null : Number(driveFile.size);
      const resolution = resolveRangeRequest(rangeHeader, driveFileSize);

      if (resolution.kind === 'unsatisfiable') {
        cleanupListeners();
        if (resolution.size > 0) {
          reply.header('Content-Range', `bytes */${resolution.size}`);
        }
        return reply.status(416).send({
          error: {
            code: 'RANGE_NOT_SATISFIABLE',
            message: 'İstenen Range aralığı dosya boyutunun dışında.',
            requestId: request.id,
          },
        });
      }

      const upstreamRangeHeader =
        resolution.kind === 'range' || resolution.kind === 'passthrough'
          ? resolution.header
          : undefined;

      const driveStreamRes = await fastify.driveService.createMediaStream(
        accessToken,
        driveFile.googleDriveFileId || '',
        // FFmpeg consumes a continuous source stream. Safari may probe the
        // output with bytes=0-1; forwarding that range would give FFmpeg only
        // two source bytes and make transcoding fail immediately.
        upstreamRangeHeader,
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

  fastify.post<{
    Querystring: { session?: string };
  }>('/transcode/release', async (request, reply) => {
    const sessionId = parseHlsSession(request.query.session);
    if (!sessionId) return reply.status(400).send();
    const stopped = fastify.transcodeService.releaseOwner(sessionId);
    return reply.status(200).send({ stopped });
  });


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

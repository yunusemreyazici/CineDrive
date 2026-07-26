import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { TranscodeQuality } from '../services/transcode.service.js';

// Browsers commonly request `bytes=N-`. Forwarding that request unchanged makes
// Google Drive send the entire remainder of a multi-GB file until the browser
// eventually closes the connection. A bounded chunk keeps prefetch/probing
// traffic predictable while retaining normal HTML5 seek support.
const MAX_STREAM_CHUNK_BYTES = 8 * 1024 * 1024;

const boundOpenEndedRange = (rangeHeader?: string): string | undefined => {
  if (!rangeHeader) return undefined;

  const match = rangeHeader.match(/^bytes=(\d+)-$/);
  if (!match) return rangeHeader;

  const start = Number.parseInt(match[1]!, 10);
  return `bytes=${start}-${start + MAX_STREAM_CHUNK_BYTES - 1}`;
};

export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  const resolveActiveDriveFile = (driveFileId: string) =>
    fastify.prisma.driveFile.findFirst({
      where: {
        OR: [
          { googleDriveFileId: driveFileId },
          { id: driveFileId },
          { localFilePath: driveFileId },
        ],
        status: 'active',
      },
      include: { library: true },
    });

  const hlsCacheKey = (
    driveFile: {
      id: string;
      size: bigint | null;
      modifiedTime: Date | null;
      md5Checksum: string | null;
    },
    startSeconds = 0,
  ) => {
    const fingerprint = createHash('sha256')
      .update(
        [
          driveFile.size?.toString() || '',
          driveFile.modifiedTime?.toISOString() || '',
          driveFile.md5Checksum || '',
        ].join(':'),
      )
      .digest('hex')
      .slice(0, 12);
    return `${driveFile.id}-${fingerprint}${startSeconds > 0 ? `-at-${startSeconds}` : ''}`;
  };

  const parseHlsStart = (value: unknown) => {
    if (value === undefined) return 0;
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
    const startSeconds = Math.floor(Number(value));
    return Number.isSafeInteger(startSeconds) &&
      startSeconds >= 0 &&
      startSeconds <= 7 * 24 * 60 * 60
      ? startSeconds
      : null;
  };

  const parseHlsSession = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;

  fastify.get<{
    Params: { driveFileId: string };
    Querystring: { time?: string };
  }>('/:driveFileId/preview', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId);
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

    let googleAccessToken: string | undefined;
    if (driveFile.storageType !== 'local') {
      try {
        googleAccessToken = await fastify.googleOAuthService.getValidAccessToken(
          request.user!.id,
          driveFile.library?.googleConnectionId || undefined,
        );
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
        googleAccessToken,
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
  const handleStreamRequest = async (
    driveFileId: string,
    userId: string,
    isHeadRequest: boolean,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    // Range validation against malformed, multi-range or amplification attacks
    const rangeHeader = request.headers.range;
    const upstreamRangeHeader = boundOpenEndedRange(rangeHeader);
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
        OR: [
          { googleDriveFileId: driveFileId },
          { id: driveFileId },
          { localFilePath: driveFileId },
        ],
        status: 'active',
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
          where: { id: movieItem.driveFileId, status: 'active' },
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

        request.raw.on('close', () => {
          kill();
          cleanupListeners();
        });

        return reply.send(transcodedStream);
      }

      const stat = fs.statSync(driveFile.localFilePath);
      const fileSize = stat.size;
      let start = 0;
      let end = fileSize - 1;
      let statusCode = 200;

      if (rangeHeader) {
        const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
        if (match) {
          start = match[1] ? parseInt(match[1], 10) : 0;
          end = match[2]
            ? parseInt(match[2], 10)
            : Math.min(start + MAX_STREAM_CHUNK_BYTES - 1, fileSize - 1);
          if (end >= fileSize) end = fileSize - 1;
          statusCode = 206;
        }
      }

      const chunkSize = end - start + 1;
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

        // Give FFmpeg a seekable HTTP input instead of a Node pipe. Google
        // Drive supports Range requests on this URL, so input-side `-ss` can
        // jump near the requested timestamp without downloading and discarding
        // the whole file from byte zero.
        const googleDriveFileId = encodeURIComponent(driveFile.googleDriveFileId || '');
        const sourceUrl =
          `https://www.googleapis.com/drive/v3/files/${googleDriveFileId}` +
          '?alt=media&supportsAllDrives=true';
        const { stream: transcodedStream, kill } = fastify.transcodeService.createTranscodedStream(
          sourceUrl,
          {
            transcodeVideo: shouldTranscodeVideo,
            quality: transcodeQuality,
            startSeconds,
            inputOptions: [
              '-headers',
              `Authorization: Bearer ${accessToken}\r\n`,
              '-rw_timeout',
              '15000000',
            ],
            ...(ownerSessionId ? { ownerSessionId } : {}),
          },
        );

        request.raw.on('close', () => {
          kill();
          cleanupListeners();
        });

        return reply.send(transcodedStream);
      }

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

  // Native Safari HLS playlist. Segments are generated once and then reused.
  fastify.get<{
    Params: { driveFileId: string };
    Querystring: { start?: string; session?: string };
  }>('/:driveFileId/hls/index.m3u8', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId);
    if (!driveFile) {
      return reply.status(404).send({
        error: {
          code: 'HLS_SOURCE_NOT_FOUND',
          message: 'HLS kaynağı bulunamadı.',
          requestId: request.id,
        },
      });
    }

    try {
      const startSeconds = parseHlsStart(request.query.start);
      if (startSeconds === null) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_HLS_START',
            message: 'Geçersiz HLS başlangıç zamanı.',
            requestId: request.id,
          },
        });
      }
      const sessionId = parseHlsSession(request.query.session);
      if (!sessionId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_HLS_SESSION',
            message: 'Geçersiz HLS oynatma oturumu.',
            requestId: request.id,
          },
        });
      }
      const playlistPath = await fastify.hlsService.ensureHls(
        hlsCacheKey(driveFile, startSeconds),
        async () => {
          if (driveFile.storageType === 'local' && driveFile.localFilePath) {
            return driveFile.localFilePath;
          }

          const accessToken = await fastify.googleOAuthService.getValidAccessToken(
            request.user!.id,
            driveFile.library?.googleConnectionId || undefined,
          );
          const googleDriveFileId = encodeURIComponent(driveFile.googleDriveFileId || '');
          return {
            url: `https://www.googleapis.com/drive/v3/files/${googleDriveFileId}?alt=media&supportsAllDrives=true`,
            inputOptions: [
              '-headers',
              `Authorization: Bearer ${accessToken}\r\n`,
              '-rw_timeout',
              '15000000',
            ],
          };
        },
        startSeconds,
        hlsCacheKey(driveFile),
        sessionId,
        driveFile.name,
        driveFile.videoCodec,
      );
      const assetQuery = `?start=${startSeconds}`;
      const playlist = fs
        .readFileSync(playlistPath, 'utf8')
        .replace(/#EXT-X-MAP:URI="([^"]+)"/g, `#EXT-X-MAP:URI="$1${assetQuery}"`)
        .replace(/^(segment-\d{6}\.m4s)$/gm, `$1${assetQuery}`);
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-cache');
      return reply.send(playlist);
    } catch (error) {
      request.log.error({ error, driveFileId: driveFile.id }, 'HLS preparation failed');
      return reply.status(500).send({
        error: {
          code: 'HLS_PREPARATION_FAILED',
          message: 'Safari uyumlu akış hazırlanamadı.',
          requestId: request.id,
        },
      });
    }
  });

  fastify.post<{
    Params: { driveFileId: string };
    Querystring: { start?: string; session?: string };
  }>('/:driveFileId/hls/release', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId);
    if (!driveFile) return reply.status(404).send();

    const startSeconds = parseHlsStart(request.query.start);
    const sessionId = parseHlsSession(request.query.session);
    if (startSeconds === null || !sessionId) {
      return reply.status(400).send();
    }

    const stopped = fastify.hlsService.releaseHls(hlsCacheKey(driveFile, startSeconds), sessionId);
    return reply.status(200).send({ stopped });
  });

  fastify.get<{
    Params: { driveFileId: string; assetName: string };
    Querystring: { start?: string };
  }>('/:driveFileId/hls/:assetName', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId);
    if (!driveFile) return reply.status(404).send();

    try {
      const startSeconds = parseHlsStart(request.query.start);
      if (startSeconds === null) return reply.status(400).send();
      const assetPath = fastify.hlsService.resolveAsset(
        hlsCacheKey(driveFile, startSeconds),
        request.params.assetName,
      );
      if (!fs.existsSync(assetPath)) return reply.status(404).send();

      const isInit = request.params.assetName === 'init.mp4';
      reply.header('Content-Type', isInit ? 'video/mp4' : 'video/iso.segment');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(fs.createReadStream(assetPath));
    } catch {
      return reply.status(404).send();
    }
  });

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

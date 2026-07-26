import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { TranscodeQuality } from '../services/transcode.service.js';
import { env } from '../config/env.js';
import { resolveRangeRequest } from '../utils/http-range.js';

// FFmpeg reads its Drive input over HTTP. Reconnecting keeps a long encode
// alive across transient upstream resets instead of failing the whole job.
const FFMPEG_HTTP_INPUT_OPTIONS = [
  '-reconnect',
  '1',
  '-reconnect_streamed',
  '1',
  '-reconnect_delay_max',
  '5',
  '-rw_timeout',
  '15000000',
];

export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // A Drive file ID alone is not an authorization decision. Every lookup is
  // scoped to a library the caller actually owns, matching the pattern already
  // used by the insights routes.
  const ownedLibraryFilter = (userId: string) => ({
    OR: [{ googleConnection: { userId } }, { googleConnectionId: null }],
  });

  const resolveActiveDriveFile = (driveFileId: string, userId: string) =>
    fastify.prisma.driveFile.findFirst({
      where: {
        OR: [
          { googleDriveFileId: driveFileId },
          { id: driveFileId },
          { localFilePath: driveFileId },
        ],
        status: 'active',
        library: ownedLibraryFilter(userId),
      },
      include: { library: true },
    });

  // FFmpeg is pointed at this server rather than at googleapis.com so each
  // (re)connection resolves a fresh access token. See DriveSourceService.
  const driveSourceInput = (
    driveFile: {
      googleDriveFileId: string | null;
      library: { googleConnectionId: string | null } | null;
    },
    userId: string,
  ) => {
    const capability = fastify.driveSourceService.issue({
      googleDriveFileId: driveFile.googleDriveFileId || '',
      userId,
      ...(driveFile.library?.googleConnectionId
        ? { connectionId: driveFile.library.googleConnectionId }
        : {}),
    });
    return {
      url: `http://127.0.0.1:${env.PORT}/api/internal/drive-source/${capability}`,
      inputOptions: [...FFMPEG_HTTP_INPUT_OPTIONS],
    };
  };

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

  const CLIENT_ABANDONED_HLS_ERRORS = new Set([
    'HLS_CLIENT_ABORTED',
    'HLS_CLIENT_RELEASED',
    'HLS_REQUEST_SUPERSEDED',
  ]);

  const isClientAbandonedHlsError = (error: unknown) =>
    error instanceof Error && CLIENT_ABANDONED_HLS_ERRORS.has(error.message);

  fastify.get<{
    Params: { driveFileId: string };
    Querystring: { time?: string };
  }>('/:driveFileId/preview', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId, request.user!.id);
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
        const source = driveSourceInput(driveFile, userId);
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

  // Native Safari HLS playlist. Segments are generated once and then reused.
  fastify.get<{
    Params: { driveFileId: string };
    Querystring: { start?: string; session?: string };
  }>('/:driveFileId/hls/index.m3u8', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId, request.user!.id);
    if (!driveFile) {
      return reply.status(404).send({
        error: {
          code: 'HLS_SOURCE_NOT_FOUND',
          message: 'HLS kaynağı bulunamadı.',
          requestId: request.id,
        },
      });
    }

    // Preparing an HLS job can take tens of seconds and may sit in a queue.
    // Without this signal a client that navigated away still consumed a global
    // transcode slot and started a full FFmpeg job nobody was waiting for.
    const abortController = new AbortController();
    const onClientClose = () => abortController.abort();
    request.raw.on('close', onClientClose);
    const cleanupListeners = () => request.raw.removeListener('close', onClientClose);
    reply.raw.on('finish', cleanupListeners);
    reply.raw.on('error', cleanupListeners);

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

          // Resolved eagerly so a disconnected Google account fails the request
          // instead of the encoder. The token itself stays server-side.
          await fastify.googleOAuthService.getValidAccessToken(
            request.user!.id,
            driveFile.library?.googleConnectionId || undefined,
          );
          return driveSourceInput(driveFile, request.user!.id);
        },
        startSeconds,
        hlsCacheKey(driveFile),
        sessionId,
        driveFile.name,
        driveFile.videoCodec,
        abortController.signal,
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
      cleanupListeners();

      // The client went away while the job was queued or starting. There is
      // nobody left to answer, and this is not a server fault worth logging.
      if (abortController.signal.aborted || isClientAbandonedHlsError(error)) {
        return;
      }

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
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId, request.user!.id);
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
    const driveFile = await resolveActiveDriveFile(request.params.driveFileId, request.user!.id);
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
      // Per-user media behind a session cookie must never enter a shared cache.
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
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

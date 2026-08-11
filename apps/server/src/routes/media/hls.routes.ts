import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env.js';
import {
  driveSourceInput,
  hlsCacheKey,
  isClientAbandonedHlsError,
  parseHlsSession,
  parseHlsStart,
  resolveActiveDriveFile,
} from './shared.js';

/** Playlist, segment and lifecycle endpoints for the Safari/WebKit HLS path. */
export const mediaHlsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { driveFileId: string };
    Querystring: { start?: string; session?: string };
  }>('/:driveFileId/hls/index.m3u8', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(fastify, request.params.driveFileId, request.user!.id);
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
    const onClientClose = () => {
      if (!reply.raw.writableEnded) abortController.abort();
    };
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
          await fastify.driveAccessService.getAccess(request.user!.id, driveFile);
          return driveSourceInput(fastify, driveFile, request.user!.id);
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

      // Only stay silent when the socket is genuinely gone. Returning without
      // a reply on a live connection leaves the request hanging until the
      // browser times out, which the player then reports as a stream failure.
      if (abortController.signal.aborted) {
        return;
      }

      // The job was superseded or its lease dropped while this request waited.
      // Nothing is wrong with the media, so ask the player to retry instead of
      // reporting a server fault.
      if (isClientAbandonedHlsError(error)) {
        request.log.info(
          { reason: (error as Error).message, driveFileId: driveFile.id },
          'HLS preparation superseded',
        );
        reply.header('Retry-After', '1');
        return reply.status(503).send({
          error: {
            code: 'HLS_PREPARATION_SUPERSEDED',
            message: 'Akış yeniden hazırlanıyor, kısa süre sonra tekrar deneyin.',
            requestId: request.id,
          },
        });
      }

      request.log.error({ error, driveFileId: driveFile.id }, 'HLS preparation failed');
      return reply.status(500).send({
        error: {
          code: 'HLS_PREPARATION_FAILED',
          message: 'Safari uyumlu akış hazırlanamadı.',
          requestId: request.id,
          // Surfacing the underlying FFmpeg/Drive failure in the response makes
          // playback problems diagnosable from the browser's network tab.
          // Withheld in production so internal details never reach end users.
          ...(env.NODE_ENV === 'production'
            ? {}
            : { detail: error instanceof Error ? error.message : String(error) }),
        },
      });
    }
  });

  fastify.post<{
    Params: { driveFileId: string };
    Querystring: { start?: string; session?: string };
  }>('/:driveFileId/hls/release', async (request, reply) => {
    const driveFile = await resolveActiveDriveFile(fastify, request.params.driveFileId, request.user!.id);
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
    const driveFile = await resolveActiveDriveFile(fastify, request.params.driveFileId, request.user!.id);
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
};

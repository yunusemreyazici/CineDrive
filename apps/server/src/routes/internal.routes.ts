import type { FastifyPluginAsync } from 'fastify';
import { isLoopbackAddress } from '../services/drive-source.service.js';
import { resolveRangeRequest } from '../utils/http-range.js';

/**
 * Loopback-only Drive source proxy consumed by FFmpeg.
 *
 * Registered outside the authenticated media plugin: a capability token is the
 * credential here, and FFmpeg carries no session cookie. Every request mints a
 * fresh Google access token, which is what allows an encode to outlive the
 * ~1 hour token lifetime.
 */
export const internalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { capability: string } }>(
    '/drive-source/:capability',
    async (request, reply) => {
      if (!isLoopbackAddress(request.socket.remoteAddress ?? undefined)) {
        return reply.status(404).send();
      }

      const capability = fastify.driveSourceService.verify(request.params.capability);
      if (!capability) {
        return reply.status(403).send();
      }

      let accessToken: string;
      try {
        accessToken = await fastify.googleOAuthService.getValidAccessToken(
          capability.userId,
          capability.connectionId,
        );
      } catch {
        return reply.status(502).send();
      }

      const abortController = new AbortController();
      const onClientAbort = () => abortController.abort();
      const onResponseClose = () => {
        if (!reply.raw.writableEnded) abortController.abort();
      };
      // IncomingMessage `close` also fires after a normal GET request body has
      // been consumed. Treating it as a disconnect aborted the Drive fetch
      // before FFmpeg received the first audio byte. `aborted` is the actual
      // premature-request signal; response `close` covers a vanished player.
      request.raw.once('aborted', onClientAbort);
      reply.raw.once('close', onResponseClose);
      const cleanupListeners = () => {
        request.raw.removeListener('aborted', onClientAbort);
        reply.raw.removeListener('close', onResponseClose);
      };
      reply.raw.on('finish', cleanupListeners);
      reply.raw.on('error', cleanupListeners);

      if (abortController.signal.aborted) {
        cleanupListeners();
        return reply.status(499).send();
      }

      // FFmpeg issues its own Range requests when seeking or reconnecting. The
      // upstream window is left unbounded here on purpose: this consumer is the
      // encoder, which reads sequentially under `-readrate`, not a browser.
      const resolution = resolveRangeRequest(request.headers.range, null);
      const upstreamRange =
        resolution.kind === 'multi' || resolution.kind === 'invalid'
          ? undefined
          : request.headers.range;

      try {
        const driveStreamRes = await fastify.driveService.createMediaStream(
          accessToken,
          capability.googleDriveFileId,
          upstreamRange,
          abortController.signal,
        );

        driveStreamRes.stream.on('error', (streamError) => {
          cleanupListeners();
          abortController.abort();
          if (!reply.raw.writableEnded) reply.raw.destroy(streamError);
        });

        reply.status(driveStreamRes.status);
        for (const header of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
        ] as const) {
          const value = driveStreamRes.headers[header];
          if (value) reply.header(header, value);
        }
        reply.header('Cache-Control', 'no-store');

        return reply.send(driveStreamRes.stream);
      } catch (error) {
        cleanupListeners();
        if (abortController.signal.aborted) return;
        request.log.error(
          { err: error, requestId: request.id },
          'Drive source proxy request failed',
        );
        return reply.status(502).send();
      }
    },
  );
};

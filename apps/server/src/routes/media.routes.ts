import type { FastifyPluginAsync } from 'fastify';
import { mediaPreviewRoutes } from './media/preview.routes.js';
import { mediaStreamRoutes } from './media/stream.routes.js';
import { mediaHlsRoutes } from './media/hls.routes.js';

/**
 * Media transport: everything that moves bytes rather than rows. Split by
 * delivery mechanism — the three groups previously shared one 838-line file
 * whose stream handler alone was 450 lines.
 */
export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  await fastify.register(mediaPreviewRoutes);
  await fastify.register(mediaStreamRoutes);
  await fastify.register(mediaHlsRoutes);
};

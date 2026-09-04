import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env.js';
import { SystemMetricsService } from '../services/system-metrics.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    systemMetricsService: SystemMetricsService;
  }
}

export const systemMetricsPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const service = new SystemMetricsService(fastify.prisma, env.DATABASE_URL, fastify.log);
  fastify.decorate('systemMetricsService', service);
  await service.start();
  fastify.addHook('onClose', async () => service.stop());
});

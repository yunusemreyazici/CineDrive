import type { FastifyPluginAsync } from 'fastify';
import type { SystemMetricsDto } from '@cinedrive/shared';

export const systemMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    if (request.user?.role !== 'admin') {
      return reply.status(403).send({
        error: {
          code: 'ADMIN_REQUIRED',
          message: 'Bu işlem için yönetici yetkisi gerekir.',
          requestId: request.id,
        },
      });
    }
  });

  fastify.get<{ Reply: SystemMetricsDto }>('/metrics', async (_request, reply) =>
    reply.status(200).send(await fastify.systemMetricsService.getDashboard()),
  );
};

import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const prisma = new PrismaClient({
    log: fastify.log.level === 'debug' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });

  await prisma.$connect();
  fastify.log.info('📦 Prisma SQLite Database connected');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
    fastify.log.info('📦 Prisma SQLite Database disconnected');
  });
});

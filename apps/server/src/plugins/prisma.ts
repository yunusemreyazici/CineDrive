import fp from 'fastify-plugin';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { createPrismaClient } from '../lib/prisma-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin: FastifyPluginAsync = fp(async (fastify: FastifyInstance) => {
  // Ensure SQLite data directory exists if using file-based SQLite
  if (env.DATABASE_URL.startsWith('file:')) {
    const dbPath = env.DATABASE_URL.replace(/^file:/, '');
    const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    const dbDir = path.dirname(absoluteDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const prisma = createPrismaClient(
    env.DATABASE_URL,
    fastify.log.level === 'debug' ? ['query', 'info', 'warn', 'error'] : ['error'],
  );

  await prisma.$connect();
  fastify.log.info('📦 Prisma SQLite Database connected');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async (instance: FastifyInstance) => {
    await instance.prisma.$disconnect();
    fastify.log.info('📦 Prisma SQLite Database disconnected');
  });
});

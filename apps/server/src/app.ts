import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import crypto from 'crypto';
import { env } from './config/env.js';
import { prismaPlugin } from './plugins/prisma.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { libraryRoutes } from './routes/library.routes.js';
import { mediaRoutes } from './routes/media.routes.js';
import { mediaQueryRoutes } from './routes/media-query.routes.js';
import { playbackRoutes, historyRoutes } from './routes/playback.routes.js';
import { favoriteRoutes } from './routes/favorite.routes.js';
import { subtitleRoutes } from './routes/subtitle.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import type { HealthResponse, ApiErrorResponse } from '@cinedrive/shared';

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    exposeHeadRoutes: false,
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: env.TRUST_PROXY,
  });

  // Register Security Plugins
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Register Core Database & Auth Plugins
  await app.register(prismaPlugin);
  await app.register(authPlugin);

  // Global Error Handler
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;
    app.log.error({ err: error, requestId }, 'Unhandled request error');

    const statusCode = error.statusCode || 500;
    const response: ApiErrorResponse = {
      error: {
        code: error.code || 'INTERNAL_SERVER_ERROR',
        message: statusCode === 500 ? 'Internal Server Error' : error.message,
        requestId,
      },
    };

    reply.status(statusCode).send(response);
  });

  // Health check endpoint
  app.get<{ Reply: HealthResponse }>('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // Register All Application Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(libraryRoutes, { prefix: '/api/libraries' });
  await app.register(mediaRoutes, { prefix: '/api/media' });
  await app.register(mediaQueryRoutes, { prefix: '/api/media' });
  await app.register(playbackRoutes, { prefix: '/api/playback' });
  await app.register(historyRoutes, { prefix: '/api/history' });
  await app.register(favoriteRoutes, { prefix: '/api/favorites' });
  await app.register(subtitleRoutes, { prefix: '/api/media' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });

  return app;
};

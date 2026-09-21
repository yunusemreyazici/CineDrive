import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import compress from '@fastify/compress';
import websocket from '@fastify/websocket';
import { listeningSessionRoutes } from './routes/listening-session.routes.js';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import crypto from 'crypto';
import { env } from './config/env.js';
import { prismaPlugin } from './plugins/prisma.js';
import { systemMetricsPlugin } from './plugins/system-metrics.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { libraryRoutes } from './routes/library.routes.js';
import { mediaRoutes } from './routes/media.routes.js';
import { mediaQueryRoutes } from './routes/media-query.routes.js';
import { mediaEditRoutes } from './routes/media-edit.routes.js';
import { playbackRoutes, historyRoutes } from './routes/playback.routes.js';
import { favoriteRoutes } from './routes/favorite.routes.js';
import { subtitleRoutes } from './routes/subtitle.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { databaseRoutes } from './routes/database.routes.js';
import { insightsRoutes } from './routes/insights.routes.js';
import { internalRoutes } from './routes/internal.routes.js';
import { musicRoutes } from './routes/music.routes.js';
import { systemMetricsRoutes } from './routes/system-metrics.routes.js';
import {
  assertProductionSchema,
  hasProductionSchema,
} from './services/database-readiness.service.js';
import type {
  HealthResponse,
  ReadinessResponse,
  ApiErrorResponse,
  ClientBootstrapDto,
} from '@cinedrive/shared';

// A single 4-second-segment HLS viewer issues roughly 15 segment requests per
// minute on top of playlist polls and scrub previews, so the general API budget
// throttles normal playback. Media transport gets its own, much larger budget.
const PLAYBACK_PATH_PATTERN =
  /^\/api\/(?:media\/[^/]+\/(?:stream|preview|hls(?:\/|$))|music\/(?:tracks\/[^/]+\/(?:stream|download)|artwork\/[^/]+)|internal\/drive-source\/)/;
const CONNECT_PATH_PATTERN =
  /^\/api\/music\/(?:playback-(?:state|clients|commands)|listening-sessions)(?:\/|$)/;
const API_RATE_LIMIT_MAX = env.NODE_ENV === 'test' ? 10_000 : 100;
const PLAYBACK_RATE_LIMIT_MAX = 1200;
const CONNECT_RATE_LIMIT_MAX = 600;
const DATABASE_READINESS_TIMEOUT_MS = 2_000;

/** Capability tokens travel in the internal source URL and must not enter logs. */
export const redactRequestUrl = (url: string): string =>
  url
    .replace(/(\/api\/internal\/drive-source\/)[^/?]+/g, '$1[redacted]')
    .replace(
      /([?&](?:token|access_token|refresh_token|id_token|downloadGrant|session|state|code)=)[^&]*/gi,
      '$1[redacted]',
    );

export const rateLimitBucket = (url: string): 'playback' | 'connect' | 'api' => {
  const path = url.split('?')[0] || '';
  if (PLAYBACK_PATH_PATTERN.test(path)) return 'playback';
  if (CONNECT_PATH_PATTERN.test(path)) return 'connect';
  return 'api';
};

export const rateLimitKey = (ip: string, url: string): string => `${ip}:${rateLimitBucket(url)}`;

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Database readiness check timed out.')), timeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const buildApp = async (
  options: { readinessTimeoutMs?: number } = {},
): Promise<FastifyInstance> => {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? DATABASE_READINESS_TIMEOUT_MS;
  const app = Fastify({
    exposeHeadRoutes: false,
    // Drive-source capability tokens (base64url payload + HMAC) travel as a
    // path param and exceed Fastify's 100-char default, which answers 414.
    routerOptions: {
      maxParamLength: 1024,
    },
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      serializers: {
        req: (request) => ({
          method: request.method,
          url: redactRequestUrl(request.url),
          host: request.headers.host,
          remoteAddress: request.ip,
        }),
      },
    },
    trustProxy: env.TRUST_PROXY,
  });

  await app.register(websocket, { options: { maxPayload: 1024 } });

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

  // JSON went over the wire uncompressed: the home page alone pulled 125 kB of
  // it. The Docker deployment gzips at nginx, but running the server directly
  // — the setup in the README, and any LAN install — had no compression at
  // all. Media never reaches this: `video/*` and the segment types are not
  // compressible, so the plugin passes byte-range and HLS responses through
  // untouched.
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  await app.register(rateLimit, {
    max: (request) => {
      const bucket = rateLimitBucket(request.url);
      if (bucket === 'playback') return PLAYBACK_RATE_LIMIT_MAX;
      if (bucket === 'connect') return CONNECT_RATE_LIMIT_MAX;
      return API_RATE_LIMIT_MAX;
    },
    keyGenerator: (request) => rateLimitKey(request.ip, request.url),
    timeWindow: '1 minute',
  });

  // Register Core Database & Auth Plugins
  await app.register(prismaPlugin);
  if (env.NODE_ENV === 'production') {
    await assertProductionSchema(app.prisma);
  }
  await app.register(systemMetricsPlugin);
  await app.register(authPlugin);

  // Global Error Handler
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;
    app.log.error({ err: error, requestId }, 'Unhandled request error');

    const statusCode = error.statusCode || 500;
    const isServerError = statusCode >= 500;
    const response: ApiErrorResponse = {
      error: {
        code: isServerError ? 'INTERNAL_SERVER_ERROR' : error.code || 'INTERNAL_SERVER_ERROR',
        message: isServerError ? 'Sunucu hatası oluştu.' : error.message || 'Sunucu hatası oluştu.',
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

  // Readiness is deliberately separate from the stable liveness endpoint:
  // orchestrators should stop routing traffic when SQLite cannot answer, while
  // /api/health remains useful for determining whether the process is alive.
  app.get<{ Reply: ReadinessResponse }>('/api/ready', async (request, reply) => {
    const timestamp = new Date().toISOString();

    try {
      await withTimeout(app.prisma.$queryRaw`SELECT 1`, readinessTimeoutMs);
      const migrationsReady =
        env.NODE_ENV !== 'production'
          ? true
          : await withTimeout(hasProductionSchema(app.prisma), readinessTimeoutMs);
      if (!migrationsReady) {
        return reply.status(503).send({
          status: 'not_ready',
          timestamp,
          checks: { database: 'ok', migrations: 'error' },
          requestId: request.id,
        });
      }
      return {
        status: 'ready',
        timestamp,
        checks: { database: 'ok', migrations: 'ok' },
      };
    } catch (error) {
      const requestId = request.id;
      app.log.error({ err: error, requestId }, 'Database readiness check failed');
      return reply.status(503).send({
        status: 'not_ready',
        timestamp,
        checks: { database: 'error', migrations: 'error' },
        requestId,
      });
    }
  });

  // Public and deliberately small: native clients use this before restoring a
  // session so new protocol features can be adopted without breaking old servers.
  app.get<{ Reply: ClientBootstrapDto }>('/api/client-bootstrap', async () => ({
    apiVersion: 2,
    minimumIOSBuild: 6,
    features: {
      deltaSyncV2: true,
      downloadManifest: true,
      seekableAAC: false,
      localizedDiscovery: true,
      scopedDownloadGrants: true,
      cineMusicConnect: true,
      cineMusicQueueControl: true,
      listeningTogether: true,
    },
    serverTime: new Date().toISOString(),
  }));

  // Register All Application Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(libraryRoutes, { prefix: '/api/libraries' });
  await app.register(mediaRoutes, { prefix: '/api/media' });
  await app.register(mediaQueryRoutes, { prefix: '/api/media' });
  await app.register(mediaEditRoutes, { prefix: '/api/media' });
  await app.register(playbackRoutes, { prefix: '/api/playback' });
  await app.register(historyRoutes, { prefix: '/api/history' });
  await app.register(favoriteRoutes, { prefix: '/api/favorites' });
  await app.register(subtitleRoutes, { prefix: '/api/media' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(databaseRoutes, { prefix: '/api/settings/database' });
  await app.register(insightsRoutes, { prefix: '/api/insights' });
  await app.register(systemMetricsRoutes, { prefix: '/api/system' });
  await app.register(musicRoutes, { prefix: '/api/music' });
  await app.register(listeningSessionRoutes, { prefix: '/api/music/listening-sessions' });
  // Loopback-only FFmpeg source proxy; authenticated by capability, not session.
  await app.register(internalRoutes, { prefix: '/api/internal' });

  return app;
};

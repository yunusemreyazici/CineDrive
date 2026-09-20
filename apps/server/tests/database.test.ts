import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

describe('database maintenance ownership', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('scopes stats and orphan cleanup to the caller-owned library', async () => {
    const admin = await app.authService.ensureAdminUserExists();
    const password = 'DatabaseScopePassword123!';
    const user = await app.prisma.user.create({
      data: {
        email: `database-scope-${randomUUID()}@cinedrive.test`,
        name: 'Database scope user',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    const [ownedLibrary, foreignLibrary] = await Promise.all([
      app.prisma.library.create({
        data: {
          userId: user.id,
          name: 'User maintenance library',
          rootFolderId: 'database-user-root',
        },
      }),
      app.prisma.library.create({
        data: {
          userId: admin.id,
          name: 'Foreign maintenance library',
          rootFolderId: 'database-foreign-root',
        },
      }),
    ]);
    const [ownedMedia, foreignMedia] = await Promise.all([
      app.prisma.mediaItem.create({
        data: {
          libraryId: ownedLibrary.id,
          type: 'movie',
          title: 'Owned orphan',
          normalizedTitle: 'owned orphan',
        },
      }),
      app.prisma.mediaItem.create({
        data: {
          libraryId: foreignLibrary.id,
          type: 'movie',
          title: 'Foreign orphan',
          normalizedTitle: 'foreign orphan',
        },
      }),
    ]);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password },
    });
    const sessionCookie = login.cookies.find((cookie) => cookie.name === 'session_id')!.value;

    const stats = await app.inject({
      method: 'GET',
      url: '/api/settings/database/stats',
      cookies: { session_id: sessionCookie },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().stats).toMatchObject({
      libraries: 1,
      movies: 1,
      orphanMedia: 1,
    });

    const cleanup = await app.inject({
      method: 'POST',
      url: '/api/settings/database/cleanup',
      cookies: { session_id: sessionCookie },
    });
    expect(cleanup.statusCode).toBe(200);
    expect(cleanup.json().removed.media).toBe(1);
    expect(await app.prisma.mediaItem.findUnique({ where: { id: ownedMedia.id } })).toBeNull();
    expect(await app.prisma.mediaItem.findUnique({ where: { id: foreignMedia.id } })).not.toBeNull();

    await app.prisma.user.delete({ where: { id: user.id } });
    await app.prisma.library.delete({ where: { id: foreignLibrary.id } });
  });

  it('does not expose or stop HLS jobs to regular users', async () => {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const adminCookie = adminLogin.cookies.find((cookie) => cookie.name === 'session_id')!.value;
    const password = 'HlsScopePassword123!';
    const user = await app.prisma.user.create({
      data: {
        email: `hls-scope-${randomUUID()}@cinedrive.test`,
        name: 'HLS scope user',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password },
    });
    const userCookie = userLogin.cookies.find((cookie) => cookie.name === 'session_id')!.value;
    const stats = app.hlsService.getStats();
    vi.spyOn(app.hlsService, 'getStats').mockReturnValue({
      ...stats,
      jobs: [
        {
          id: 'private-job',
          cacheKey: 'private-cache',
          mediaName: 'Private movie',
          pid: null,
          startSeconds: 0,
          startedAt: new Date().toISOString(),
          lastAccessAt: new Date().toISOString(),
          viewerCount: 1,
          profile: 'h264-aac',
          bufferLeadSeconds: 0,
          isPaused: false,
        },
      ],
    });
    const stopSpy = vi.spyOn(app.hlsService, 'stopJob').mockReturnValue(true);

    const health = await app.inject({
      method: 'GET',
      url: '/api/insights/media-health',
      cookies: { session_id: userCookie },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().runtime.hls.jobs).toEqual([]);

    const forbiddenStop = await app.inject({
      method: 'POST',
      url: '/api/insights/media-health/hls/private-job/stop',
      cookies: { session_id: userCookie },
    });
    expect(forbiddenStop.statusCode).toBe(403);
    expect(stopSpy).not.toHaveBeenCalled();

    const adminStop = await app.inject({
      method: 'POST',
      url: '/api/insights/media-health/hls/private-job/stop',
      cookies: { session_id: adminCookie },
    });
    expect(adminStop.statusCode).toBe(200);
    expect(stopSpy).toHaveBeenCalledWith('private-job');

    await app.prisma.user.delete({ where: { id: user.id } });
  });
});

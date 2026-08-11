import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

describe('API settings', () => {
  let app: FastifyInstance;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const user = await app.authService.ensureAdminUserExists();
    userId = user.id;
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
  });

  afterAll(async () => {
    await app.prisma.user.update({
      where: { id: userId },
      data: { opensubtitlesApiKey: null, opensubtitlesUsername: null, tmdbApiKey: null },
    });
    await app.close();
  });

  it('stores provider keys without returning their values to the browser', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/api-keys',
      cookies: { session_id: cookie },
      payload: {
        openSubtitlesApiKey: 'open-secret-value',
        openSubtitlesUsername: 'subtitle-user',
        preferredLanguages: 'tr,en',
        tmdbApiKey: 'tmdb-secret-value',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('open-secret-value');
    expect(response.body).not.toContain('tmdb-secret-value');
    expect(JSON.parse(response.body)).toMatchObject({
      openSubtitles: { source: 'user', hasApiKey: true, username: 'subtitle-user' },
      tmdb: { source: 'user', hasApiKey: true },
    });
    expect(await app.prisma.user.findUnique({ where: { id: userId } })).toMatchObject({
      opensubtitlesApiKey: 'open-secret-value',
      tmdbApiKey: 'tmdb-secret-value',
    });

    const read = await app.inject({
      method: 'GET',
      url: '/api/settings/api-keys',
      cookies: { session_id: cookie },
    });
    expect(read.body).not.toContain('open-secret-value');
    expect(read.body).not.toContain('tmdb-secret-value');
  });

  it('explicitly clears user keys while preserving environment fallback status', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/api-keys',
      cookies: { session_id: cookie },
      payload: { clearOpenSubtitlesApiKey: true, clearTmdbApiKey: true },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).tmdb.source).not.toBe('user');
    expect(await app.prisma.user.findUnique({ where: { id: userId } })).toMatchObject({
      opensubtitlesApiKey: null,
      tmdbApiKey: null,
    });
  });
});

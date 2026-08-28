import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

describe('Playback & History API Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();

    // Clean up test data
    await app.prisma.playbackProgress.deleteMany({
      where: { mediaItemId: 'media_test_pb_1' },
    });
    await app.prisma.watchHistory.deleteMany({
      where: { mediaItemId: 'media_test_pb_1' },
    });
    await app.prisma.mediaItem.deleteMany({
      where: { id: 'media_test_pb_1' },
    });

    await app.prisma.mediaItem.create({
      data: {
        id: 'media_test_pb_1',
        type: 'movie',
        title: 'Matrix',
        normalizedTitle: 'matrix',
        year: 1999,
        duration: 8100,
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('PUT /api/playback/progress without auth should return 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: 500,
        durationSeconds: 8100,
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('PUT /api/playback/progress keeps validation issue details in the 400 response', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');

    const response = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: -1,
        durationSeconds: 8100,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['positionSeconds'] })]),
    );
  });

  it('PUT /api/playback/progress with valid payload should calculate percentage and completed status', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    // 1. Partial Progress (e.g. 50%)
    const res1 = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: 4050,
        durationSeconds: 8100,
      },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    expect(body1.progress.percentage).toBe(50);
    expect(body1.progress.completed).toBe(false);

    // 2. Near Completion Progress (95% -> completed = true)
    const res2 = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: 7700,
        durationSeconds: 8100,
      },
    });

    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    expect(body2.progress.completed).toBe(true);

    const [progressRows, historyRows] = await Promise.all([
      app.prisma.playbackProgress.count({
        where: { mediaItemId: 'media_test_pb_1', episodeId: null },
      }),
      app.prisma.watchHistory.count({
        where: { mediaItemId: 'media_test_pb_1', episodeId: null },
      }),
    ]);
    expect(progressRows).toBe(1);
    expect(historyRows).toBe(1);
  });

  it('PUT /api/playback/progress with invalid episode ID should return 400', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        episodeId: 'fake_ep_id_999',
        positionSeconds: 100,
        durationSeconds: 1000,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_EPISODE');
  });

  it('GET /api/history and DELETE /api/history should handle watch history management', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    // Create progress/history entry
    await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: 1200,
        durationSeconds: 8100,
      },
    });

    // GET /api/history
    const historyRes = await app.inject({
      method: 'GET',
      url: '/api/history',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(historyRes.statusCode).toBe(200);
    const historyData = JSON.parse(historyRes.body);
    expect(historyData.history.length).toBeGreaterThan(0);

    // DELETE /api/history (clear all)
    const clearRes = await app.inject({
      method: 'DELETE',
      url: '/api/history',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(clearRes.statusCode).toBe(200);

    const historyAfterClear = await app.inject({
      method: 'GET',
      url: '/api/history',
      cookies: { session_id: sessionCookie!.value },
    });
    const progressAfterClear = await app.prisma.playbackProgress.findMany({
      where: { mediaItemId: 'media_test_pb_1' },
    });
    const continueAfterClear = await app.inject({
      method: 'GET',
      url: '/api/playback/continue',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(JSON.parse(historyAfterClear.body).history).toHaveLength(0);
    expect(progressAfterClear).toHaveLength(0);
    expect(JSON.parse(continueAfterClear.body).items).toHaveLength(0);
  });
});

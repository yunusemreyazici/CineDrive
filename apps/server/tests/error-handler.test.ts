import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('global error handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();

    app.get('/__test/errors/internal', async () => {
      throw new Error('database password appeared in an internal stack trace');
    });

    app.get('/__test/errors/service-unavailable', async () => {
      const error = new Error('upstream host and token must stay private');
      Object.assign(error, { statusCode: 503, code: 'UPSTREAM_CONNECTION_FAILURE' });
      throw error;
    });

    app.get('/__test/errors/bad-request', async () => {
      const error = new Error('İstek geçersiz.');
      Object.assign(error, { statusCode: 400, code: 'EXPECTED_BAD_REQUEST' });
      throw error;
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a generic response for unexpected exceptions and logs the real error with requestId', async () => {
    const logError = vi.spyOn(app.log, 'error');
    const requestId = 'error-handler-regression-request';
    const response = await app.inject({
      method: 'GET',
      url: '/__test/errors/internal',
      headers: { 'x-request-id': requestId },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Sunucu hatası oluştu.',
        requestId,
      },
    });
    expect(response.body).not.toContain('database password');
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: 'database password appeared in an internal stack trace',
        }),
        requestId,
      }),
      'Unhandled request error',
    );
  });

  it('keeps an explicit 5xx status while hiding its code and message', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/errors/service-unavailable',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Sunucu hatası oluştu.',
      },
    });
    expect(response.body).not.toContain('upstream host');
    expect(response.body).not.toContain('UPSTREAM_CONNECTION_FAILURE');
  });

  it('preserves expected 4xx error behavior', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/errors/bad-request',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'EXPECTED_BAD_REQUEST',
        message: 'İstek geçersiz.',
      },
    });
  });
});

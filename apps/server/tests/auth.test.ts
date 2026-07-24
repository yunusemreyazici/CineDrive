import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

describe('Auth & Health API Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health should return 200 OK', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/auth/session without cookie should return unauthenticated state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  it('POST /api/auth/login with wrong credentials should return 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: 'WrongPassword123!',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/auth/login with valid admin credentials should succeed and set session_id cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.user.email).toBe(env.ADMIN_EMAIL);
    expect(body.user.role).toBe('admin');

    const cookies = response.cookies;
    const sessionCookie = cookies.find((c) => c.name === 'session_id');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);

    // Verify session check with cookie
    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      cookies: {
        session_id: sessionCookie!.value,
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    const sessionBody = JSON.parse(sessionResponse.body);
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.user.email).toBe(env.ADMIN_EMAIL);

    // Verify logout
    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: {
        session_id: sessionCookie!.value,
      },
    });

    expect(logoutResponse.statusCode).toBe(200);
  });
});

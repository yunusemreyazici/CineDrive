import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../src/generated/prisma/client.js';
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

  it('GET /api/ready should return 200 when the database responds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { database: 'ok' },
    });
  });

  it('GET /api/ready should return a safe 503 when the database check fails', async () => {
    const internalMessage = 'file:/private/database/path.db could not be opened';
    vi.spyOn(app.prisma, '$queryRaw').mockRejectedValueOnce(new Error(internalMessage));

    const response = await app.inject({
      method: 'GET',
      url: '/api/ready',
      headers: { 'x-request-id': 'readiness-failure-request' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      checks: { database: 'error' },
      timestamp: expect.any(String),
      requestId: 'readiness-failure-request',
    });
    expect(response.body).not.toContain(internalMessage);
  });

  it('GET /api/ready should time out without leaking implementation details', async () => {
    const timeoutApp = await buildApp({ readinessTimeoutMs: 10 });
    await timeoutApp.ready();
    vi.spyOn(timeoutApp.prisma, '$queryRaw').mockImplementationOnce(
      () => new Promise(() => undefined) as Prisma.PrismaPromise<unknown>,
    );

    try {
      const response = await timeoutApp.inject({
        method: 'GET',
        url: '/api/ready',
        headers: { 'x-request-id': 'readiness-timeout-request' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'not_ready',
        checks: { database: 'error' },
        requestId: 'readiness-timeout-request',
      });
      expect(response.body).not.toContain('timed out');
    } finally {
      await timeoutApp.close();
    }
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

    // Verify profile update
    const updateProfileRes = await app.inject({
      method: 'PUT',
      url: '/api/auth/profile',
      cookies: { session_id: sessionCookie!.value },
      payload: { name: 'Yeni Admin Isim' },
    });
    expect(updateProfileRes.statusCode).toBe(200);
    const updateProfileBody = JSON.parse(updateProfileRes.body);
    expect(updateProfileBody.user.name).toBe('Yeni Admin Isim');

    // Create isolated test user for password change test
    const tempUser = await app.prisma.user.create({
      data: {
        email: 'temp_pwd_user@example.com',
        name: 'Temp Pwd User',
        passwordHash: await app.authService.hashPassword('OriginalTempPass123!'),
        role: 'user',
      },
    });

    const tempLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'temp_pwd_user@example.com',
        password: 'OriginalTempPass123!',
      },
    });
    const tempCookie = tempLoginRes.cookies.find((c) => c.name === 'session_id');

    // Verify change password with wrong current password should return 400
    const wrongPasswordRes = await app.inject({
      method: 'PUT',
      url: '/api/auth/change-password',
      cookies: { session_id: tempCookie!.value },
      payload: {
        currentPassword: 'WrongPassword123!',
        newPassword: 'NewSecureAdminPassword123!',
      },
    });
    expect(wrongPasswordRes.statusCode).toBe(400);

    // Verify change password with valid current password
    const changePasswordRes = await app.inject({
      method: 'PUT',
      url: '/api/auth/change-password',
      cookies: { session_id: tempCookie!.value },
      payload: {
        currentPassword: 'OriginalTempPass123!',
        newPassword: 'NewSecureAdminPassword123!',
      },
    });
    expect(changePasswordRes.statusCode).toBe(200);

    // Cleanup temp user
    await app.prisma.user.delete({ where: { id: tempUser.id } });

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

  it('lets an administrator create and disable a user account', async () => {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const adminCookie = adminLogin.cookies.find((cookie) => cookie.name === 'session_id')!.value;
    const email = `managed-${Date.now()}@cinedrive.test`;
    const password = 'ManagedUserPassword123!';
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/users',
      cookies: { session_id: adminCookie },
      payload: { email, name: 'Managed User', password, role: 'user' },
    });
    expect(created.statusCode).toBe(201);
    const user = JSON.parse(created.body).user;
    expect(user).toMatchObject({ email, role: 'user', disabled: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/auth/users/${user.id}`,
      cookies: { session_id: adminCookie },
      payload: { disabled: true },
    });
    expect(disabled.statusCode).toBe(200);
    expect(JSON.parse(disabled.body).user.disabled).toBe(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password },
        })
      ).statusCode,
    ).toBe(403);
    await app.prisma.user.delete({ where: { id: user.id } });
  });
});

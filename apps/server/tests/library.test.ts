import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

// Mock googleapis to avoid 15s network timeout on unauthenticated Google OAuth refresh
vi.mock('googleapis', () => {
  const mockOAuth2Client = {
    generateAuthUrl: vi.fn(),
    getToken: vi.fn(),
    setCredentials: vi.fn(),
    refreshAccessToken: vi.fn().mockRejectedValue(new Error('GOOGLE_ACCOUNT_NOT_CONNECTED')),
    revokeToken: vi.fn(),
  };

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => mockOAuth2Client),
      },
      drive: vi.fn().mockReturnValue({
        files: {
          list: vi.fn().mockRejectedValue(new Error('GOOGLE_ACCOUNT_NOT_CONNECTED')),
        },
      }),
    },
  };
});

describe('Library API Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/libraries without auth should return 401 Unauthorized', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/libraries',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/libraries with auth should return libraries list', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    const response = await app.inject({
      method: 'GET',
      url: '/api/libraries',
      cookies: {
        session_id: sessionCookie!.value,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.libraries)).toBe(true);
  });

  it('POST /api/libraries with auth should create new library', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    const response = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      cookies: {
        session_id: sessionCookie!.value,
      },
      payload: {
        name: 'Movies Library',
        rootFolderId: 'folder_abc123',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.library.name).toBe('Movies Library');
    expect(body.library.rootFolderId).toBe('folder_abc123');
  });

  it(
    'POST /api/libraries/:id/scan without Google connection should return 400',
    async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: env.ADMIN_EMAIL,
          password: env.ADMIN_PASSWORD,
        },
      });

      const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/libraries',
        cookies: {
          session_id: sessionCookie!.value,
        },
        payload: {
          name: 'Test Lib',
          rootFolderId: 'root_folder_test',
        },
      });

      const libId = JSON.parse(createRes.body).library.id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/libraries/${libId}/scan`,
        cookies: {
          session_id: sessionCookie!.value,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('GOOGLE_ACCOUNT_NOT_CONNECTED');
    },
    15000,
  );

  it("a second account can neither list nor address another user's library", async () => {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const adminCookie = adminLogin.cookies.find((c) => c.name === 'session_id')!.value;

    const created = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      cookies: { session_id: adminCookie },
      payload: { name: 'Private Library', rootFolderId: 'owner_only_folder' },
    });
    const privateLibraryId = JSON.parse(created.body).library.id;

    const intruderPassword = 'IntruderPassword123!';
    const intruderEmail = `intruder-${Date.now()}@cinedrive.test`;
    await app.prisma.user.create({
      data: {
        email: intruderEmail,
        name: 'Intruder',
        passwordHash: await app.authService.hashPassword(intruderPassword),
      },
    });

    const intruderLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: intruderEmail, password: intruderPassword },
    });
    const intruderCookie = intruderLogin.cookies.find((c) => c.name === 'session_id')!.value;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/libraries',
      cookies: { session_id: intruderCookie },
    });
    const libraries = JSON.parse(listed.body).libraries as { id: string }[];
    expect(libraries.some((library) => library.id === privateLibraryId)).toBe(false);

    // Not 403: an id the caller may not use should be indistinguishable from
    // one that does not exist.
    const scans = await app.inject({
      method: 'GET',
      url: `/api/libraries/${privateLibraryId}/scans`,
      cookies: { session_id: intruderCookie },
    });
    expect(scans.statusCode).toBe(404);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/libraries/${privateLibraryId}`,
      cookies: { session_id: intruderCookie },
      payload: { name: 'Hijacked' },
    });
    expect(patched.statusCode).toBe(404);

    await app.prisma.user.deleteMany({ where: { email: intruderEmail } });
    await app.prisma.library.deleteMany({ where: { id: privateLibraryId } });
  });
});

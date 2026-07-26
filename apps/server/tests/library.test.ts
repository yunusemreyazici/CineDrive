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

  it("GET /api/media hides another account's media", async () => {
    const owner = await app.authService.ensureAdminUserExists();

    const ownerLibrary = await app.prisma.library.create({
      data: { userId: owner.id, name: 'OwnerScopedLib', rootFolderId: 'owner_scoped' },
    });
    const ownerMedia = await app.prisma.mediaItem.create({
      data: {
        libraryId: ownerLibrary.id,
        type: 'movie',
        title: 'Owner Only Movie',
        normalizedTitle: 'owner only movie',
      },
    });

    const intruderEmail = `scope-${Date.now()}@cinedrive.test`;
    const intruderPassword = 'ScopedPassword123!';
    const intruder = await app.prisma.user.create({
      data: {
        email: intruderEmail,
        name: 'Scoped',
        passwordHash: await app.authService.hashPassword(intruderPassword),
      },
    });
    const intruderLibrary = await app.prisma.library.create({
      data: { userId: intruder.id, name: 'IntruderScopedLib', rootFolderId: 'intruder_scoped' },
    });
    const intruderMedia = await app.prisma.mediaItem.create({
      data: {
        libraryId: intruderLibrary.id,
        type: 'movie',
        title: 'Intruder Only Movie',
        normalizedTitle: 'intruder only movie',
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: intruderEmail, password: intruderPassword },
    });
    const sessionCookie = login.cookies.find((c) => c.name === 'session_id')!.value;

    const response = await app.inject({
      method: 'GET',
      url: '/api/media?limit=100',
      cookies: { session_id: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    const ids = (JSON.parse(response.body).media as { id: string }[]).map((item) => item.id);

    // The catalogue itself was unscoped: favourites and progress were filtered
    // by user, the media list returned every row in the database.
    expect(ids).toContain(intruderMedia.id);
    expect(ids).not.toContain(ownerMedia.id);

    await app.prisma.library.deleteMany({
      where: { id: { in: [ownerLibrary.id, intruderLibrary.id] } },
    });
    await app.prisma.user.deleteMany({ where: { email: intruderEmail } });
  });

  it('clearing one library leaves the other library untouched', async () => {
    const owner = await app.authService.ensureAdminUserExists();

    const makeLibrary = async (name: string, title: string) => {
      const library = await app.prisma.library.create({
        data: { userId: owner.id, name, rootFolderId: `${name}_root` },
      });
      const driveFile = await app.prisma.driveFile.create({
        data: {
          libraryId: library.id,
          googleDriveFileId: `${name}_file`,
          name: `${title}.mkv`,
          mimeType: 'video/x-matroska',
          status: 'active',
        },
      });
      const mediaItem = await app.prisma.mediaItem.create({
        // Scans set this; the fixture predates the column.
        data: {
          libraryId: library.id,
          type: 'movie',
          title,
          normalizedTitle: title.toLowerCase(),
        },
      });
      await app.prisma.movie.create({
        data: { mediaItemId: mediaItem.id, driveFileId: driveFile.id },
      });
      await app.prisma.favorite.create({
        data: { userId: owner.id, mediaItemId: mediaItem.id },
      });
      return { library, mediaItem };
    };

    const doomed = await makeLibrary('ClearTargetLib', 'Doomed Movie');
    const keeper = await makeLibrary('ClearKeeperLib', 'Kept Movie');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id')!.value;

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/libraries/${doomed.library.id}/clear`,
      cookies: { session_id: sessionCookie },
    });

    expect(response.statusCode).toBe(200);

    // The whole point: this used to be an unfiltered deleteMany.
    expect(await app.prisma.mediaItem.findUnique({ where: { id: doomed.mediaItem.id } })).toBeNull();
    expect(
      await app.prisma.mediaItem.findUnique({ where: { id: keeper.mediaItem.id } }),
    ).not.toBeNull();
    expect(
      await app.prisma.favorite.count({ where: { mediaItemId: keeper.mediaItem.id } }),
    ).toBe(1);
    expect(await app.prisma.driveFile.count({ where: { libraryId: keeper.library.id } })).toBe(1);

    await app.prisma.library.deleteMany({
      where: { id: { in: [doomed.library.id, keeper.library.id] } },
    });
    await app.prisma.mediaItem.deleteMany({ where: { id: keeper.mediaItem.id } });
  });

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

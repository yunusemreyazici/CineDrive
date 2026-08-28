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

  it('POST /api/media/batch-delete preserves its validation error response', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');

    const response = await app.inject({
      method: 'POST',
      url: '/api/media/batch-delete',
      cookies: { session_id: sessionCookie!.value },
      payload: { ids: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'En az 1 içerik seçilmelidir.',
      }),
    );
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

  it('POST /api/libraries/:id/scan without Google connection should return 400', async () => {
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
  }, 15000);

  it("refuses to edit, delete or favourite another account's media", async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const ownerLibrary = await app.prisma.library.create({
      data: { userId: owner.id, name: 'GuardedLib', rootFolderId: 'guarded_root' },
    });
    const ownerMedia = await app.prisma.mediaItem.create({
      data: {
        libraryId: ownerLibrary.id,
        type: 'movie',
        title: 'Guarded Movie',
        normalizedTitle: 'guarded movie',
      },
    });

    const intruderEmail = `guard-${Date.now()}@cinedrive.test`;
    const intruderPassword = 'GuardPassword123!';
    await app.prisma.user.create({
      data: {
        email: intruderEmail,
        name: 'Guard',
        passwordHash: await app.authService.hashPassword(intruderPassword),
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: intruderEmail, password: intruderPassword },
    });
    const cookies = { session_id: login.cookies.find((c) => c.name === 'session_id')!.value };

    // Media ids are derived from the title (`media_movie_...`), so reaching
    // another account's row never required guessing a random identifier.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/media/${ownerMedia.id}`,
      cookies,
      payload: { title: 'Hijacked' },
    });
    expect(patched.statusCode).toBe(404);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/media/${ownerMedia.id}`,
      cookies,
    });
    expect(deleted.statusCode).toBe(404);

    const batch = await app.inject({
      method: 'POST',
      url: '/api/media/batch-delete',
      cookies,
      payload: { ids: [ownerMedia.id] },
    });
    expect(batch.statusCode).toBe(200);
    expect(JSON.parse(batch.body).deletedCount).toBe(0);

    const favorited = await app.inject({
      method: 'POST',
      url: `/api/favorites/${ownerMedia.id}`,
      cookies,
    });
    expect(favorited.statusCode).toBe(404);

    const survivor = await app.prisma.mediaItem.findUnique({ where: { id: ownerMedia.id } });
    expect(survivor?.title).toBe('Guarded Movie');

    await app.prisma.library.deleteMany({ where: { id: ownerLibrary.id } });
    await app.prisma.user.deleteMany({ where: { email: intruderEmail } });
  });

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
    expect(
      await app.prisma.mediaItem.findUnique({ where: { id: doomed.mediaItem.id } }),
    ).toBeNull();
    expect(
      await app.prisma.mediaItem.findUnique({ where: { id: keeper.mediaItem.id } }),
    ).not.toBeNull();
    expect(await app.prisma.favorite.count({ where: { mediaItemId: keeper.mediaItem.id } })).toBe(
      1,
    );
    expect(await app.prisma.driveFile.count({ where: { libraryId: keeper.library.id } })).toBe(1);

    await app.prisma.library.deleteMany({
      where: { id: { in: [doomed.library.id, keeper.library.id] } },
    });
    await app.prisma.mediaItem.deleteMany({ where: { id: keeper.mediaItem.id } });
  });

  it('removes a local library and its indexed records without touching the folder', async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const suffix = Date.now();
    const library = await app.prisma.library.create({
      data: {
        userId: owner.id,
        name: `Removable Local ${suffix}`,
        storageType: 'local',
        localFolderPath: `/tmp/cinedrive-local-${suffix}`,
      },
    });
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        storageType: 'local',
        localFilePath: `/tmp/cinedrive-local-${suffix}/movie.mp4`,
        name: 'Local Movie.mp4',
        mimeType: 'video/mp4',
      },
    });
    const media = await app.prisma.mediaItem.create({
      data: {
        libraryId: library.id,
        type: 'movie',
        title: 'Local Movie',
        normalizedTitle: 'local movie',
      },
    });
    await app.prisma.movie.create({ data: { mediaItemId: media.id, driveFileId: file.id } });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/libraries/${library.id}`,
      cookies: {
        session_id: login.cookies.find((cookie) => cookie.name === 'session_id')!.value,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).removed).toEqual({ library: 1, media: 1, files: 1 });
    expect(await app.prisma.library.findUnique({ where: { id: library.id } })).toBeNull();
    expect(await app.prisma.driveFile.findUnique({ where: { id: file.id } })).toBeNull();
    expect(await app.prisma.mediaItem.findUnique({ where: { id: media.id } })).toBeNull();
  });

  it('clears indexed data from every owned library while preserving sources', async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const suffix = Date.now();
    const connection = await app.prisma.googleConnection.create({
      data: {
        userId: owner.id,
        googleAccountId: `clear-all-${suffix}`,
        email: `clear-all-${suffix}@cinedrive.test`,
        encryptedRefreshToken: 'not-used-by-this-test',
        scopes: 'drive.readonly',
      },
    });
    const driveLibrary = await app.prisma.library.create({
      data: {
        userId: owner.id,
        name: `Clear All Drive ${suffix}`,
        storageType: 'gdrive',
        googleConnectionId: connection.id,
        lastScannedAt: new Date(),
      },
    });
    const localLibrary = await app.prisma.library.create({
      data: {
        userId: owner.id,
        name: `Clear All Local ${suffix}`,
        storageType: 'local',
        localFolderPath: `/tmp/cinedrive-clear-all-${suffix}`,
        lastScannedAt: new Date(),
      },
    });
    const source = await app.prisma.driveScanSource.create({
      data: {
        libraryId: driveLibrary.id,
        googleConnectionId: connection.id,
        rootFolderId: `clear-all-folder-${suffix}`,
      },
    });
    const driveFile = await app.prisma.driveFile.create({
      data: {
        libraryId: driveLibrary.id,
        googleConnectionId: connection.id,
        driveScanSourceId: source.id,
        googleDriveFileId: `clear-all-drive-file-${suffix}`,
        name: 'Drive Movie.mp4',
        mimeType: 'video/mp4',
      },
    });
    const localFile = await app.prisma.driveFile.create({
      data: {
        libraryId: localLibrary.id,
        storageType: 'local',
        localFilePath: `/tmp/cinedrive-clear-all-${suffix}/movie.mp4`,
        name: 'Local Movie.mp4',
        mimeType: 'video/mp4',
      },
    });
    await app.prisma.mediaItem.createMany({
      data: [
        {
          libraryId: driveLibrary.id,
          type: 'movie',
          title: 'Drive Clear All Movie',
          normalizedTitle: 'drive clear all movie',
        },
        {
          libraryId: localLibrary.id,
          type: 'movie',
          title: 'Local Clear All Movie',
          normalizedTitle: 'local clear all movie',
        },
      ],
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/settings/database/clear',
      cookies: {
        session_id: login.cookies.find((cookie) => cookie.name === 'session_id')!.value,
      },
    });

    expect(response.statusCode).toBe(200);
    const removed = JSON.parse(response.body).removed as { media: number; files: number };
    expect(removed.media).toBeGreaterThanOrEqual(2);
    expect(removed.files).toBeGreaterThanOrEqual(2);
    expect(await app.prisma.library.findUnique({ where: { id: driveLibrary.id } })).not.toBeNull();
    expect(await app.prisma.library.findUnique({ where: { id: localLibrary.id } })).not.toBeNull();
    expect(
      await app.prisma.driveScanSource.findUnique({ where: { id: source.id } }),
    ).not.toBeNull();
    expect(await app.prisma.driveFile.findUnique({ where: { id: driveFile.id } })).toBeNull();
    expect(await app.prisma.driveFile.findUnique({ where: { id: localFile.id } })).toBeNull();
    expect(
      await app.prisma.mediaItem.count({
        where: { libraryId: { in: [driveLibrary.id, localLibrary.id] } },
      }),
    ).toBe(0);
    expect(
      await app.prisma.library.count({
        where: { id: { in: [driveLibrary.id, localLibrary.id] }, lastScannedAt: null },
      }),
    ).toBe(2);

    await app.prisma.library.deleteMany({
      where: { id: { in: [driveLibrary.id, localLibrary.id] } },
    });
    await app.prisma.googleConnection.delete({ where: { id: connection.id } });
  });

  it('starts a scan for the selected Drive source only', async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const suffix = Date.now();
    const connection = await app.prisma.googleConnection.create({
      data: {
        userId: owner.id,
        googleAccountId: `rescan-source-${suffix}`,
        email: `rescan-source-${suffix}@cinedrive.test`,
        encryptedRefreshToken: 'not-used-by-this-test',
        scopes: 'drive.readonly',
      },
    });
    const library = await app.prisma.library.create({
      data: { userId: owner.id, name: `Rescan Source ${suffix}`, storageType: 'gdrive' },
    });
    const source = await app.prisma.driveScanSource.create({
      data: {
        libraryId: library.id,
        googleConnectionId: connection.id,
        rootFolderId: `folder-${suffix}`,
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const cookies = {
      session_id: login.cookies.find((cookie) => cookie.name === 'session_id')!.value,
    };

    const scanSource = vi
      .spyOn(app.libraryScanService, 'scanSource')
      .mockImplementation(async (userId, libraryId, sourceId) => {
        expect(userId).toBe(owner.id);
        expect(libraryId).toBe(library.id);
        expect(sourceId).toBe(source.id);
        const scan = await app.prisma.libraryScan.create({
          data: { libraryId, status: 'running' },
        });
        return scan.id;
      });

    const response = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/drive-sources/${source.id}/scan`,
      cookies,
    });

    expect(response.statusCode).toBe(202);
    expect(scanSource).toHaveBeenCalledTimes(1);
    expect(JSON.parse(response.body).scan).toEqual(
      expect.objectContaining({ libraryId: library.id, status: 'running' }),
    );

    scanSource.mockRestore();
    const missing = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/drive-sources/missing-source/scan`,
      cookies,
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.body).error.code).toBe('DRIVE_SOURCE_NOT_FOUND');

    await app.prisma.library.delete({ where: { id: library.id } });
    await app.prisma.googleConnection.delete({ where: { id: connection.id } });
  });

  it('reconciles orphaned scans and their Drive source in unified history', async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const suffix = Date.now();
    const connection = await app.prisma.googleConnection.create({
      data: {
        userId: owner.id,
        googleAccountId: `orphaned-scan-${suffix}`,
        email: `orphaned-scan-${suffix}@cinedrive.test`,
        encryptedRefreshToken: 'not-used-by-this-test',
        scopes: 'drive.readonly',
      },
    });
    const library = await app.prisma.library.create({
      data: { userId: owner.id, name: `Orphaned Scan ${suffix}`, storageType: 'gdrive' },
    });
    const startedAt = new Date(Date.now() - 60_000);
    const source = await app.prisma.driveScanSource.create({
      data: {
        libraryId: library.id,
        googleConnectionId: connection.id,
        rootFolderId: `orphaned-folder-${suffix}`,
        folderName: 'Orphaned Folder',
        lastScanStatus: 'running',
        lastScannedAt: startedAt,
      },
    });
    const scan = await app.prisma.libraryScan.create({
      data: {
        libraryId: library.id,
        driveScanSourceId: source.id,
        status: 'running',
        startedAt,
        heartbeatAt: startedAt,
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const cookies = {
      session_id: login.cookies.find((cookie) => cookie.name === 'session_id')!.value,
    };

    const response = await app.inject({ method: 'GET', url: '/api/libraries/scans', cookies });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).scans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: scan.id,
          status: 'interrupted',
          interruptionReason: 'server_restarted',
        }),
      ]),
    );
    expect(await app.prisma.libraryScan.findUnique({ where: { id: scan.id } })).toMatchObject({
      status: 'interrupted',
      interruptionReason: 'server_restarted',
    });
    expect(await app.prisma.driveScanSource.findUnique({ where: { id: source.id } })).toMatchObject(
      {
        lastScanStatus: 'interrupted',
        lastScanInterruptionReason: 'server_restarted',
      },
    );

    const activeScan = await app.prisma.libraryScan.create({
      data: {
        libraryId: library.id,
        driveScanSourceId: source.id,
        status: 'running',
        heartbeatAt: new Date(),
      },
    });
    app.scanLifecycleService.register(activeScan.id, library.id, [source.id]);
    const whileActive = await app.inject({ method: 'GET', url: '/api/libraries/scans', cookies });
    expect(
      JSON.parse(whileActive.body).scans.find(
        (candidate: { id: string }) => candidate.id === activeScan.id,
      ),
    ).toMatchObject({ status: 'running' });
    app.scanLifecycleService.finish(activeScan.id);

    await app.prisma.library.delete({ where: { id: library.id } });
    await app.prisma.googleConnection.delete({ where: { id: connection.id } });
  });

  it('lists Drive folders and removes only content indexed from the disconnected source', async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const connection = await app.prisma.googleConnection.create({
      data: {
        userId: owner.id,
        googleAccountId: `source-account-${Date.now()}`,
        email: 'source-account@cinedrive.test',
        encryptedRefreshToken: 'not-used-by-this-test',
        scopes: 'drive.readonly',
      },
    });
    const library = await app.prisma.library.create({
      data: { userId: owner.id, name: 'Source Management', storageType: 'gdrive' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const cookies = {
      session_id: login.cookies.find((cookie) => cookie.name === 'session_id')!.value,
    };

    const tokenLookup = vi
      .spyOn(app.googleOAuthService, 'getValidAccessToken')
      .mockResolvedValue('test-access-token');
    const folderInspection = vi
      .spyOn(app.driveService, 'inspectFolder')
      .mockImplementation(async (_token, folderId) => ({
        id: folderId,
        name: folderId === 'folder-one' ? 'Folder One' : 'Folder Two',
        path: folderId === 'folder-one' ? 'My Drive / Folder One' : 'My Drive / Folder Two',
        ownerName: 'Source Account',
        webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
        ancestorIds: [],
        hasMediaFiles: true,
      }));

    const first = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/drive-sources`,
      cookies,
      payload: { googleConnectionId: connection.id, rootFolderId: 'folder-one' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/drive-sources`,
      cookies,
      payload: { googleConnectionId: connection.id, rootFolderId: 'folder-two' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/drive-sources/validate`,
      cookies,
      payload: { googleConnectionId: connection.id, rootFolderId: 'folder-one' },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(JSON.parse(duplicate.body).error.code).toBe('DRIVE_SOURCE_DUPLICATE');

    folderInspection.mockImplementationOnce(async (_token, folderId) => ({
      id: folderId,
      name: 'Nested Folder',
      path: 'My Drive / Folder One / Nested Folder',
      ownerName: 'Source Account',
      webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
      ancestorIds: ['folder-one'],
      hasMediaFiles: true,
    }));
    const overlap = await app.inject({
      method: 'POST',
      url: `/api/libraries/${library.id}/drive-sources/validate`,
      cookies,
      payload: { googleConnectionId: connection.id, rootFolderId: 'nested-folder' },
    });
    expect(overlap.statusCode).toBe(400);
    expect(JSON.parse(overlap.body).error.code).toBe('DRIVE_SOURCE_OVERLAP');
    expect(tokenLookup).toHaveBeenCalledTimes(4);
    expect(folderInspection).toHaveBeenCalledTimes(5);
    tokenLookup.mockRestore();
    folderInspection.mockRestore();
    const firstSourceId = JSON.parse(first.body).source.id as string;
    const secondSourceId = JSON.parse(second.body).source.id as string;

    const makeMovie = async (sourceId: string, suffix: string) => {
      const file = await app.prisma.driveFile.create({
        data: {
          libraryId: library.id,
          googleConnectionId: connection.id,
          driveScanSourceId: sourceId,
          googleDriveFileId: `source-file-${suffix}`,
          name: `Source ${suffix}.mp4`,
          mimeType: 'video/mp4',
        },
      });
      const media = await app.prisma.mediaItem.create({
        data: {
          libraryId: library.id,
          type: 'movie',
          title: `Source ${suffix}`,
          normalizedTitle: `source ${suffix}`,
        },
      });
      await app.prisma.movie.create({ data: { mediaItemId: media.id, driveFileId: file.id } });
      return { file, media };
    };
    const removedMovie = await makeMovie(firstSourceId, 'one');
    const keptMovie = await makeMovie(secondSourceId, 'two');

    const listed = await app.inject({
      method: 'GET',
      url: `/api/libraries/${library.id}/drive-sources`,
      cookies,
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.body).sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rootFolderId: 'folder-one',
          folderName: 'Folder One',
          fileCount: 1,
        }),
        expect.objectContaining({
          rootFolderId: 'folder-two',
          folderName: 'Folder Two',
          fileCount: 1,
        }),
      ]),
    );

    const scan = await app.prisma.libraryScan.create({
      data: {
        libraryId: library.id,
        driveScanSourceId: secondSourceId,
        status: 'completed',
        addedCount: 1,
        durationMs: 250,
        completedAt: new Date(),
        errors: { create: { errorMessage: 'Test scan warning' } },
      },
    });
    const history = await app.inject({ method: 'GET', url: '/api/libraries/scans', cookies });
    expect(history.statusCode).toBe(200);
    expect(JSON.parse(history.body).scans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: scan.id,
          sourceName: 'Folder Two',
          sourceType: 'drive',
          errors: [expect.objectContaining({ errorMessage: 'Test scan warning' })],
        }),
      ]),
    );

    const seriesMedia = await app.prisma.mediaItem.create({
      data: {
        libraryId: library.id,
        type: 'series',
        title: 'Shared Source Series',
        normalizedTitle: 'shared source series',
      },
    });
    const series = await app.prisma.series.create({ data: { mediaItemId: seriesMedia.id } });
    const season = await app.prisma.season.create({
      data: { seriesId: series.id, seasonNumber: 1 },
    });
    const removedEpisodeFile = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        googleConnectionId: connection.id,
        driveScanSourceId: firstSourceId,
        googleDriveFileId: 'source-series-episode-one',
        name: 'Shared Source Series S01E01.mp4',
        mimeType: 'video/mp4',
      },
    });
    const keptEpisodeFile = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        googleConnectionId: connection.id,
        driveScanSourceId: secondSourceId,
        googleDriveFileId: 'source-series-episode-two',
        name: 'Shared Source Series S01E02.mp4',
        mimeType: 'video/mp4',
      },
    });
    await app.prisma.episode.createMany({
      data: [
        {
          seriesId: series.id,
          seasonId: season.id,
          mediaItemId: seriesMedia.id,
          driveFileId: removedEpisodeFile.id,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Episode 1',
        },
        {
          seriesId: series.id,
          seasonId: season.id,
          mediaItemId: seriesMedia.id,
          driveFileId: keptEpisodeFile.id,
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'Episode 2',
        },
      ],
    });

    const disconnected = await app.inject({
      method: 'DELETE',
      url: `/api/libraries/${library.id}/drive-sources/${firstSourceId}`,
      cookies,
    });
    expect(disconnected.statusCode).toBe(200);
    expect(
      await app.prisma.driveFile.findUnique({ where: { id: removedMovie.file.id } }),
    ).toBeNull();
    expect(
      await app.prisma.mediaItem.findUnique({ where: { id: removedMovie.media.id } }),
    ).toBeNull();
    expect(
      await app.prisma.driveFile.findUnique({ where: { id: keptMovie.file.id } }),
    ).not.toBeNull();
    expect(
      await app.prisma.mediaItem.findUnique({ where: { id: keptMovie.media.id } }),
    ).not.toBeNull();
    expect(
      await app.prisma.driveFile.findUnique({ where: { id: removedEpisodeFile.id } }),
    ).toBeNull();
    expect(
      await app.prisma.driveFile.findUnique({ where: { id: keptEpisodeFile.id } }),
    ).not.toBeNull();
    expect(await app.prisma.mediaItem.findUnique({ where: { id: seriesMedia.id } })).not.toBeNull();
    expect(
      await app.prisma.episode.findMany({ where: { mediaItemId: seriesMedia.id } }),
    ).toHaveLength(1);

    await app.prisma.library.delete({ where: { id: library.id } });
    await app.prisma.googleConnection.delete({ where: { id: connection.id } });
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

  it('shares a library with a listener without granting management access', async () => {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const adminCookie = adminLogin.cookies.find((cookie) => cookie.name === 'session_id')!.value;
    const created = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      cookies: { session_id: adminCookie },
      payload: { name: 'Shared Library', rootFolderId: 'shared_folder' },
    });
    const libraryId = JSON.parse(created.body).library.id;
    const password = 'ListenerPassword123!';
    const listener = await app.prisma.user.create({
      data: {
        email: `listener-${Date.now()}@cinedrive.test`,
        name: 'Listener',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    const granted = await app.inject({
      method: 'PUT',
      url: `/api/libraries/${libraryId}/members`,
      cookies: { session_id: adminCookie },
      payload: { userId: listener.id, role: 'listener' },
    });
    expect(granted.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: listener.email, password },
    });
    const listenerCookie = login.cookies.find((cookie) => cookie.name === 'session_id')!.value;
    const listed = await app.inject({
      method: 'GET',
      url: '/api/libraries',
      cookies: { session_id: listenerCookie },
    });
    expect(JSON.parse(listed.body).libraries).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: libraryId, accessRole: 'listener' })]),
    );
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/libraries/${libraryId}`,
      cookies: { session_id: listenerCookie },
      payload: { name: 'Not allowed' },
    });
    expect(patched.statusCode).toBe(404);
    await app.prisma.user.delete({ where: { id: listener.id } });
    await app.prisma.library.delete({ where: { id: libraryId } });
  });
});

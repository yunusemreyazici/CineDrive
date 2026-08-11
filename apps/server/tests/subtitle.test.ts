import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import { OpenSubtitlesService } from '../src/services/opensubtitles.service';

describe('Subtitle API Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();

    // Clean up old test records
    await app.prisma.mediaItem.deleteMany({
      where: { id: 'media_sub_persist' },
    });
    await app.prisma.subtitleTrack.deleteMany({
      where: { driveFileId: 'db_sub_file_1' },
    });
    await app.prisma.driveFile.deleteMany({
      where: { googleDriveFileId: 'gdrive_sub_id_100' },
    });
    await app.prisma.library.deleteMany({
      where: { rootFolderId: 'test_sub_root' },
    });

    const owner = await app.authService.ensureAdminUserExists();

    const lib = await app.prisma.library.create({
      data: {
        userId: owner.id,
        name: 'Subtitle Test Library',
        rootFolderId: 'test_sub_root',
      },
    });

    const driveFile = await app.prisma.driveFile.create({
      data: {
        id: 'db_sub_file_1',
        libraryId: lib.id,
        googleDriveFileId: 'gdrive_sub_id_100',
        name: 'Inception.2010.tr.srt',
        mimeType: 'text/plain',
        size: BigInt(512),
        status: 'active',
      },
    });

    await app.prisma.subtitleTrack.create({
      data: {
        id: 'sub_track_1',
        driveFileId: driveFile.id,
        language: 'tr',
        label: 'Türkçe',
        sourceFormat: 'srt',
        isDefault: true,
      },
    });

    vi.spyOn(app.googleOAuthService, 'getValidAccessToken').mockResolvedValue('mock-access-token');
    vi.spyOn(app.driveAccessService, 'getAccess').mockResolvedValue({
      accessToken: 'mock-access-token',
      connectionId: 'mock-connection-id',
    });
    vi.spyOn(app.subtitleService['driveService'], 'getFileTextContent').mockResolvedValue(`1
00:00:01,000 --> 00:00:04,000
Test altyazı metni
`);
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/media/:subtitleDriveFileId/subtitle without auth should return 401 Unauthorized', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_sub_id_100/subtitle',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/media/:subtitleDriveFileId/subtitle with valid auth should convert SRT to WebVTT and return 200 OK', async () => {
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
      url: '/api/media/gdrive_sub_id_100/subtitle',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/vtt');
    expect(response.body).toContain('WEBVTT');
    expect(response.body).toContain('00:00:01.000 --> 00:00:04.000');
    expect(response.body).toContain('Test altyazı metni');
  });

  it('GET /api/media/:subtitleDriveFileId/subtitle for non-existent file should return 404', async () => {
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
      url: '/api/media/non_existent_sub_file/subtitle',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(response.statusCode).toBe(404);
  });

  it('persists a manually selected OpenSubtitles file on the media item', async () => {
    const library = await app.prisma.library.findFirstOrThrow({
      where: { rootFolderId: 'test_sub_root' },
    });
    const videoFile = await app.prisma.driveFile.create({
      data: {
        id: 'db_video_sub_persist',
        libraryId: library.id,
        googleDriveFileId: 'gdrive_video_sub_persist',
        name: 'Persistent.Subtitle.Movie.mkv',
        mimeType: 'video/x-matroska',
        status: 'active',
      },
    });
    await app.prisma.mediaItem.create({
      data: {
        id: 'media_sub_persist',
        // Scans set this and the subtitle routes now filter on it.
        libraryId: library.id,
        type: 'movie',
        title: 'Persistent Subtitle Movie',
        normalizedTitle: 'persistent-subtitle-movie',
        movie: {
          create: {
            id: 'movie_sub_persist',
            driveFileId: videoFile.id,
          },
        },
      },
    });
    vi.spyOn(OpenSubtitlesService.prototype, 'downloadAndConvertSubtitle').mockResolvedValue(`WEBVTT

00:00:01.000 --> 00:00:04.000
Kalıcı altyazı`);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');

    const response = await app.inject({
      method: 'POST',
      url: '/api/media/subtitles/opensubtitles/download',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        fileId: 987654,
        mediaId: 'media_sub_persist',
        label: 'Türkçe Kalıcı',
        languageCode: 'tr',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.subtitleTrack.label).toBe('Türkçe Kalıcı');
    expect(body.vttContent).toContain('Kalıcı altyazı');
    const persistedTrack = await app.prisma.subtitleTrack.findUnique({
      where: { id: body.subtitleTrack.id },
      include: { driveFile: true },
    });
    expect(persistedTrack).toMatchObject({
      mediaItemId: 'media_sub_persist',
      language: 'tr',
    });
    expect(persistedTrack?.driveFile.localFilePath).toContain('subtitle_cache');

    const persistedResponse = await app.inject({
      method: 'GET',
      url: body.subtitleTrack.url,
      cookies: { session_id: sessionCookie!.value },
    });
    expect(persistedResponse.statusCode).toBe(200);
    expect(persistedResponse.body).toContain('Kalıcı altyazı');
  });

  it("does not serve or attach subtitles for another account's media", async () => {
    const intruderEmail = `sub-guard-${Date.now()}@cinedrive.test`;
    const intruderPassword = 'SubGuardPassword123!';
    await app.prisma.user.create({
      data: {
        email: intruderEmail,
        name: 'Sub Guard',
        passwordHash: await app.authService.hashPassword(intruderPassword),
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: intruderEmail, password: intruderPassword },
    });
    const cookies = { session_id: login.cookies.find((c) => c.name === 'session_id')!.value };

    // `getSubtitleWebVTT` took a userId and never compared it, so subtitle
    // content was readable by any signed-in account.
    const content = await app.inject({
      method: 'GET',
      url: '/api/media/db_sub_file_1/subtitle',
      cookies,
    });
    expect(content.statusCode).toBe(404);

    // Downloading also spends the target account's OpenSubtitles quota.
    const auto = await app.inject({
      method: 'POST',
      url: '/api/media/media_sub_persist/auto-subtitle',
      cookies,
      payload: {},
    });
    expect(auto.statusCode).toBe(404);

    await app.prisma.user.deleteMany({ where: { email: intruderEmail } });
  });
});

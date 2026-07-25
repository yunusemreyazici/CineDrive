import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'stream';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

describe('Video Media Streaming API Integration Tests', () => {
  let app: FastifyInstance;
  let mockDriveStream: Readable;
  let abortSignalReceived: AbortSignal | undefined;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();

    // Clean up old test records to prevent unique constraint failures
    await app.prisma.driveFile.deleteMany({
      where: { googleDriveFileId: 'gdrive_video_id_100' },
    });
    await app.prisma.library.deleteMany({
      where: { rootFolderId: 'test_root_folder_id' },
    });

    // Create default library in DB
    const lib = await app.prisma.library.create({
      data: {
        name: 'Streaming Test Library',
        rootFolderId: 'test_root_folder_id',
      },
    });

    // Create a mock active video DriveFile in DB
    await app.prisma.driveFile.create({
      data: {
        id: 'db_video_file_1',
        libraryId: lib.id,
        googleDriveFileId: 'gdrive_video_id_100',
        name: 'Inception.2010.mp4',
        mimeType: 'video/mp4',
        size: BigInt(10485760), // 10 MB
        status: 'active',
      },
    });

    // Mock GoogleOAuthService getValidAccessToken
    app.googleOAuthService.getValidAccessToken = vi.fn().mockResolvedValue('mock-access-token');

    // Mock GoogleDriveService createMediaStream
    app.driveService.createMediaStream = vi.fn().mockImplementation(
      async (
        _token: string,
        _fileId: string,
        rangeHeader?: string,
        signal?: AbortSignal,
      ) => {
        abortSignalReceived = signal;

        if (rangeHeader === 'bytes=invalid-range') {
          const err = new Error('Range Not Satisfiable') as Error & { code: number };
          err.code = 416;
          throw err;
        }

        mockDriveStream = new Readable({
          read() {
            this.push(Buffer.from('fake-video-stream-chunk-data'));
            this.push(null);
          },
        });

        if (rangeHeader) {
          return {
            stream: mockDriveStream,
            status: 206,
            headers: {
              'content-type': 'video/mp4',
              'content-length': '1024',
              'content-range': 'bytes 0-1023/10485760',
              'accept-ranges': 'bytes',
              'etag': '"mock-etag-123"',
              'last-modified': 'Wed, 21 Oct 2025 07:28:00 GMT',
            },
          };
        }

        return {
          stream: mockDriveStream,
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '10485760',
            'accept-ranges': 'bytes',
          },
        };
      },
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/media/:fileId/stream without auth should return 401 Unauthorized', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_video_id_100/stream',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/media/:fileId/stream with valid auth and Range header should return 206 Partial Content & Content-Range', async () => {
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
      url: '/api/media/gdrive_video_id_100/stream',
      cookies: { session_id: sessionCookie!.value },
      headers: {
        range: 'bytes=0-1023',
      },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['content-range']).toBe('bytes 0-1023/10485760');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['etag']).toBe('"mock-etag-123"');
    expect(response.body).toBe('fake-video-stream-chunk-data');
  });

  it('bounds open-ended browser ranges to avoid downloading the entire remaining file', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_video_id_100/stream',
      cookies: { session_id: sessionCookie!.value },
      headers: {
        range: 'bytes=1048576-',
      },
    });

    expect(app.driveService.createMediaStream).toHaveBeenCalledWith(
      'mock-access-token',
      'gdrive_video_id_100',
      'bytes=1048576-9437183',
      expect.any(AbortSignal),
    );
  });

  it('returns transcoded streams without source Range or Content-Length headers', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');
    app.transcodeService.createTranscodedStream = vi.fn().mockReturnValue({
      stream: Readable.from(Buffer.from('transcoded-fragment')),
      kill: vi.fn(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_video_id_100/stream?transcode=true',
      cookies: { session_id: sessionCookie!.value },
      headers: {
        range: 'bytes=0-',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['content-range']).toBeUndefined();
    expect(response.headers['accept-ranges']).toBeUndefined();
    expect(response.headers['content-length']).toBeUndefined();
    expect(response.body).toBe('transcoded-fragment');
    expect(app.transcodeService.createTranscodedStream).toHaveBeenCalledWith(
      expect.any(Readable),
      { transcodeVideo: false, quality: '1080p', startSeconds: 0 },
    );
    expect(app.driveService.createMediaStream).toHaveBeenCalledWith(
      'mock-access-token',
      'gdrive_video_id_100',
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('uses full video transcoding for Safari compatibility mode', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');
    app.transcodeService.createTranscodedStream = vi.fn().mockReturnValue({
      stream: Readable.from(Buffer.from('safari-transcoded-fragment')),
      kill: vi.fn(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_video_id_100/stream?transcode=full',
      cookies: { session_id: sessionCookie!.value },
      headers: {
        range: 'bytes=0-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(app.transcodeService.createTranscodedStream).toHaveBeenCalledWith(
      expect.any(Readable),
      { transcodeVideo: true, quality: '1080p', startSeconds: 0 },
    );
    expect(app.driveService.createMediaStream).toHaveBeenCalledWith(
      'mock-access-token',
      'gdrive_video_id_100',
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('restarts compatibility transcoding at the requested seek position', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');
    app.transcodeService.createTranscodedStream = vi.fn().mockReturnValue({
      stream: Readable.from(Buffer.from('seeked-transcoded-fragment')),
      kill: vi.fn(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_video_id_100/stream?transcode=audio&start=2028&session=player_session_2028',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(response.statusCode).toBe(200);
    expect(app.transcodeService.createTranscodedStream).toHaveBeenCalledWith(
      expect.any(Readable),
      {
        transcodeVideo: true,
        quality: '1080p',
        startSeconds: 2028,
        ownerSessionId: 'player_session_2028',
      },
    );
  });

  it('releases the FFmpeg process owned by a player tab', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');
    const releaseSpy = vi.spyOn(app.transcodeService, 'releaseOwner').mockReturnValue(true);

    const response = await app.inject({
      method: 'POST',
      url: '/api/media/transcode/release?session=player_session_2028',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ stopped: true });
    expect(releaseSpy).toHaveBeenCalledWith('player_session_2028');
  });

  it('rejects an unknown transcode quality profile', async () => {
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
      url: '/api/media/gdrive_video_id_100/stream?transcode=full&quality=8k',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_TRANSCODE_QUALITY');
  });

  it('GET /api/media/:fileId/stream with invalid Range should return 416 Range Not Satisfiable', async () => {
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
      url: '/api/media/gdrive_video_id_100/stream',
      cookies: { session_id: sessionCookie!.value },
      headers: {
        range: 'bytes=invalid-range',
      },
    });

    expect(response.statusCode).toBe(416);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('RANGE_NOT_SATISFIABLE');
  });

  it('GET /api/media/:fileId/stream for unregistered file should return 404 Not Found', async () => {
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
      url: '/api/media/unregistered_gdrive_file_999/stream',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('should pass AbortSignal to GoogleDriveService for client disconnect handling', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    await app.inject({
      method: 'GET',
      url: '/api/media/gdrive_video_id_100/stream',
      cookies: { session_id: sessionCookie!.value },
    });

    expect(abortSignalReceived).toBeDefined();
    expect(typeof abortSignalReceived?.aborted).toBe('boolean');
  });
});

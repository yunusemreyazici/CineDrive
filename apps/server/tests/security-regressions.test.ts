import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import { resolveMediaItemId } from '../src/services/media-item-id.service';

describe('security regression coverage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not expose DriveFile internals from the season listing', async () => {
    const admin = await app.authService.ensureAdminUserExists();
    const library = await app.prisma.library.create({
      data: {
        userId: admin.id,
        name: `Season DTO ${randomUUID()}`,
        storageType: 'local',
        localFolderPath: '/media/films',
      },
    });
    const media = await app.prisma.mediaItem.create({
      data: {
        libraryId: library.id,
        type: 'series',
        title: 'Safe Series',
        normalizedTitle: `safe series ${randomUUID()}`,
      },
    });
    const series = await app.prisma.series.create({ data: { mediaItemId: media.id } });
    const season = await app.prisma.season.create({
      data: { seriesId: series.id, seasonNumber: 1, name: 'Season 1' },
    });
    const video = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        storageType: 'local',
        localFilePath: `/private/media/${randomUUID()}/episode.mkv`,
        name: 'episode.mkv',
        mimeType: 'video/x-matroska',
        status: 'active',
      },
    });
    const subtitleFile = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        storageType: 'local',
        localFilePath: `/private/secrets/${randomUUID()}.srt`,
        name: 'episode.tr.srt',
        mimeType: 'application/x-subrip',
        status: 'active',
      },
    });
    const episode = await app.prisma.episode.create({
      data: {
        seriesId: series.id,
        seasonId: season.id,
        mediaItemId: media.id,
        driveFileId: video.id,
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Episode 1',
      },
    });
    await app.prisma.subtitleTrack.create({
      data: {
        episodeId: episode.id,
        driveFileId: subtitleFile.id,
        language: 'tr',
        label: 'Türkçe',
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: admin.email, password: env.ADMIN_PASSWORD },
    });
    const cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
    const response = await app.inject({
      method: 'GET',
      url: `/api/media/series/${series.id}/seasons`,
      cookies: { session_id: cookie },
    });

    expect(response.statusCode).toBe(200);
    const returnedSubtitle = response.json().seasons[0].episodes[0].subtitles[0];
    expect(returnedSubtitle.driveFile).toEqual({
      id: subtitleFile.id,
      googleDriveFileId: null,
    });
    expect(response.body).not.toContain('localFilePath');
    expect(response.body).not.toContain('/private/secrets');

    const episodeResponse = await app.inject({
      method: 'GET',
      url: `/api/media/seasons/${season.id}/episodes`,
      cookies: { session_id: cookie },
    });
    expect(episodeResponse.statusCode).toBe(200);
    expect(episodeResponse.body).not.toContain('localFilePath');
    expect(episodeResponse.body).not.toContain('/private/secrets');

    await app.prisma.library.delete({ where: { id: library.id } });
  });

  it('records only owned telemetry and hides recent identifiers from regular users', async () => {
    const password = 'TelemetryScopePassword123!';
    const user = await app.prisma.user.create({
      data: {
        email: `telemetry-${randomUUID()}@cinedrive.test`,
        name: 'Telemetry user',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    const library = await app.prisma.library.create({
      data: {
        userId: user.id,
        name: `Telemetry library ${randomUUID()}`,
        storageType: 'local',
        localFolderPath: '/media/telemetry',
      },
    });
    const media = await app.prisma.mediaItem.create({
      data: {
        libraryId: library.id,
        type: 'movie',
        title: 'Telemetry movie',
        normalizedTitle: `telemetry movie ${randomUUID()}`,
      },
    });
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        storageType: 'local',
        localFilePath: `/media/telemetry/${randomUUID()}.mp4`,
        name: 'telemetry.mp4',
        mimeType: 'video/mp4',
        status: 'active',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password },
    });
    const cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/insights/player-telemetry',
      cookies: { session_id: cookie },
      payload: {
        mediaId: media.id,
        driveFileId: file.id,
        browser: 'chromium',
        playbackMode: 'direct',
        event: 'first-frame',
        durationMs: 200,
      },
    });
    expect(accepted.statusCode).toBe(202);

    const health = await app.inject({
      method: 'GET',
      url: '/api/insights/media-health',
      cookies: { session_id: cookie },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().runtime.playerTelemetry).toMatchObject({
      sampleCount: 1,
      recent: [],
    });

    const discarded = await app.inject({
      method: 'POST',
      url: '/api/insights/player-telemetry',
      cookies: { session_id: cookie },
      payload: {
        mediaId: 'foreign-media-id',
        driveFileId: 'foreign-drive-file-id',
        browser: 'chromium',
        playbackMode: 'direct',
        event: 'error',
      },
    });
    expect(discarded.statusCode).toBe(202);

    await app.prisma.library.delete({ where: { id: library.id } });
    await app.prisma.user.delete({ where: { id: user.id } });
  });

  it('does not stream a local DB path outside the configured library root', async () => {
    const admin = await app.authService.ensureAdminUserExists();
    const library = await app.prisma.library.create({
      data: {
        userId: admin.id,
        name: `Local boundary ${randomUUID()}`,
        storageType: 'local',
        localFolderPath: os.tmpdir(),
      },
    });
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId: library.id,
        storageType: 'local',
        localFilePath: '/etc/hosts',
        name: 'not-really-a-video.mp4',
        mimeType: 'video/mp4',
        status: 'active',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: admin.email, password: env.ADMIN_PASSWORD },
    });
    const cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;

    const response = await app.inject({
      method: 'GET',
      url: `/api/media/${file.id}/stream`,
      cookies: { session_id: cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('root:');
    await app.prisma.library.delete({ where: { id: library.id } });
  });

  it('marks local files that disappeared between scans as missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-local-reconcile-'));
    try {
      const admin = await app.authService.ensureAdminUserExists();
      const library = await app.prisma.library.create({
        data: {
          userId: admin.id,
          name: `Reconcile ${randomUUID()}`,
          storageType: 'local',
          localFolderPath: root,
        },
      });
      const file = await app.prisma.driveFile.create({
        data: {
          libraryId: library.id,
          storageType: 'local',
          localFilePath: path.join(root, 'removed.mp4'),
          name: 'removed.mp4',
          mimeType: 'video/mp4',
          status: 'active',
        },
      });

      const scanId = await app.localScanService.startLocalScan(library.id);
      let scan = await app.prisma.libraryScan.findUnique({ where: { id: scanId } });
      for (let attempt = 0; attempt < 100 && scan?.status === 'running'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        scan = await app.prisma.libraryScan.findUnique({ where: { id: scanId } });
      }

      expect(scan?.status).toBe('completed');
      expect(scan?.deletedCount).toBe(1);
      expect((await app.prisma.driveFile.findUnique({ where: { id: file.id } }))?.status).toBe(
        'missing',
      );
      await app.prisma.library.delete({ where: { id: library.id } });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps same-title media isolated between libraries', async () => {
    const admin = await app.authService.ensureAdminUserExists();
    const [firstLibrary, secondLibrary] = await Promise.all([
      app.prisma.library.create({
        data: { userId: admin.id, name: `Identity A ${randomUUID()}`, storageType: 'gdrive' },
      }),
      app.prisma.library.create({
        data: { userId: admin.id, name: `Identity B ${randomUUID()}`, storageType: 'gdrive' },
      }),
    ]);
    const baseId = await resolveMediaItemId(app.prisma, 'movie', 'same title', firstLibrary.id);
    await app.prisma.mediaItem.create({
      data: {
        id: baseId,
        libraryId: firstLibrary.id,
        type: 'movie',
        title: 'Same Title',
        normalizedTitle: 'same title',
      },
    });

    expect(await resolveMediaItemId(app.prisma, 'movie', 'same title', firstLibrary.id)).toBe(baseId);
    expect(await resolveMediaItemId(app.prisma, 'movie', 'same title', secondLibrary.id)).toBe(
      `${baseId}_${secondLibrary.id}`,
    );
    await app.prisma.library.delete({ where: { id: firstLibrary.id } });
    await app.prisma.library.delete({ where: { id: secondLibrary.id } });
  });

  it('pages large insights catalogues without changing aggregate results', async () => {
    const password = 'InsightsPagesPassword123!';
    const user = await app.prisma.user.create({
      data: {
        email: `insights-pages-${randomUUID()}@cinedrive.test`,
        name: 'Insights pages user',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    const library = await app.prisma.library.create({
      data: {
        userId: user.id,
        name: `Insights pages ${randomUUID()}`,
        storageType: 'gdrive',
      },
    });
    const files = Array.from({ length: 501 }, (_, index) => ({
      libraryId: library.id,
      storageType: 'gdrive',
      googleDriveFileId: `insights-page-${randomUUID()}-${index}`,
      name: `page-${index}.mp4`,
      mimeType: 'video/mp4',
      size: BigInt(index + 1),
      status: 'active',
    }));
    for (let offset = 0; offset < files.length; offset += 100) {
      await app.prisma.driveFile.createMany({ data: files.slice(offset, offset + 100) });
    }

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password },
    });
    const cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
    const [storage, health] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/insights/storage', cookies: { session_id: cookie } }),
      app.inject({ method: 'GET', url: '/api/insights/media-health', cookies: { session_id: cookie } }),
    ]);

    expect(storage.statusCode).toBe(200);
    expect(storage.json()).toMatchObject({ totalFiles: 501, totalSizeBytes: (501 * 502) / 2 });
    expect(storage.json().largestFiles[0].size).toBe(501);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ totalVideos: 501, pendingVideos: 501 });
    await app.prisma.user.delete({ where: { id: user.id } });
  });
});

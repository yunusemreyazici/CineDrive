import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

describe('Playback & History API Integration Tests', () => {
  let app: FastifyInstance;
  const playbackLibraryId = 'library_test_pb_1';

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();

    // Playback writes are now scoped through MediaItem.library, so the fixture
    // must model the same ownership relation as production media.
    await app.prisma.library.deleteMany({ where: { id: playbackLibraryId } });
    const admin = await app.prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL } });
    if (!admin) throw new Error('Admin fixture user was not created');

    await app.prisma.library.create({
      data: {
        id: playbackLibraryId,
        userId: admin.id,
        name: 'Playback test library',
        rootFolderId: 'playback-test-root',
      },
    });

    await app.prisma.mediaItem.create({
      data: {
        id: 'media_test_pb_1',
        libraryId: playbackLibraryId,
        type: 'movie',
        title: 'Matrix',
        normalizedTitle: 'matrix',
        year: 1999,
        duration: 8100,
      },
    });

    await app.prisma.mediaItem.createMany({
      data: [
        {
          id: 'media_test_pb_2',
          libraryId: playbackLibraryId,
          type: 'movie',
          title: 'Arrival',
          normalizedTitle: 'arrival',
          year: 2016,
          duration: 6960,
        },
        {
          id: 'media_test_pb_series',
          libraryId: playbackLibraryId,
          type: 'series',
          title: 'Playback Series',
          normalizedTitle: 'playback series',
        },
      ],
    });
    const series = await app.prisma.series.create({
      data: { mediaItemId: 'media_test_pb_series' },
    });
    const season = await app.prisma.season.create({
      data: { seriesId: series.id, seasonNumber: 1, name: 'Season 1' },
    });
    const episodeFile = await app.prisma.driveFile.create({
      data: {
        libraryId: playbackLibraryId,
        storageType: 'local',
        localFilePath: `/tmp/cinedrive-playback-${randomUUID()}.mp4`,
        name: 'Playback Series - S01E01.mp4',
        mimeType: 'video/mp4',
      },
    });
    await app.prisma.episode.create({
      data: {
        seriesId: series.id,
        seasonId: season.id,
        mediaItemId: 'media_test_pb_series',
        driveFileId: episodeFile.id,
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Episode 1',
        duration: 3600,
      },
    });
  });

  afterEach(async () => {
    await app.prisma.library.deleteMany({ where: { id: playbackLibraryId } });
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

  it('PUT /api/playback/progress cannot write progress for another library', async () => {
    const password = 'PlaybackIntruderPassword123!';
    const intruder = await app.prisma.user.create({
      data: {
        email: `playback-intruder-${randomUUID()}@cinedrive.test`,
        name: 'Playback intruder',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: intruder.email, password },
    });
    const sessionCookie = login.cookies.find((cookie) => cookie.name === 'session_id');

    const response = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: 120,
        durationSeconds: 8100,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(
      await app.prisma.playbackProgress.count({
        where: { userId: intruder.id, mediaItemId: 'media_test_pb_1' },
      }),
    ).toBe(0);
    await app.prisma.user.delete({ where: { id: intruder.id } });
  });

  it('removes playback visibility and write access after library membership is revoked', async () => {
    const password = 'PlaybackMemberPassword123!';
    const member = await app.prisma.user.create({
      data: {
        email: `playback-member-${randomUUID()}@cinedrive.test`,
        name: 'Playback member',
        passwordHash: await app.authService.hashPassword(password),
      },
    });
    await app.prisma.libraryMembership.create({
      data: { libraryId: playbackLibraryId, userId: member.id, role: 'listener' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: member.email, password },
    });
    const sessionCookie = login.cookies.find((cookie) => cookie.name === 'session_id');

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        mediaItemId: 'media_test_pb_1',
        positionSeconds: 120,
        durationSeconds: 8100,
      },
    });
    expect(saved.statusCode).toBe(200);

    await app.prisma.libraryMembership.delete({
      where: { libraryId_userId: { libraryId: playbackLibraryId, userId: member.id } },
    });

    const [history, continueWatching, progress, writeAfterRevoke] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/history',
        cookies: { session_id: sessionCookie!.value },
      }),
      app.inject({
        method: 'GET',
        url: '/api/playback/continue',
        cookies: { session_id: sessionCookie!.value },
      }),
      app.inject({
        method: 'GET',
        url: '/api/playback/media_test_pb_1',
        cookies: { session_id: sessionCookie!.value },
      }),
      app.inject({
        method: 'PUT',
        url: '/api/playback/progress',
        cookies: { session_id: sessionCookie!.value },
        payload: {
          mediaItemId: 'media_test_pb_1',
          positionSeconds: 240,
          durationSeconds: 8100,
        },
      }),
    ]);

    expect(history.json().history).toHaveLength(0);
    expect(continueWatching.json().items).toHaveLength(0);
    expect(progress.json()).toMatchObject({ progress: null, all: [] });
    expect(writeAfterRevoke.statusCode).toBe(404);

    await app.prisma.user.delete({ where: { id: member.id } });
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

  it('orders progress by server revision and client sequence, not device wall-clock time', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');
    const common = {
      mediaItemId: 'media_test_pb_1',
      durationSeconds: 8100,
      clientInstanceId: 'playback-test-client',
    };

    const first = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 100,
        clientSequence: 1,
        clientTimestamp: Date.now() + 30_000,
      },
    });
    expect(first.statusCode).toBe(200);

    // This request is newer by sequence but its clock is 30 seconds behind.
    // The old Date.now() comparison incorrectly discarded it.
    const clockSkewed = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 200,
        clientSequence: 2,
        clientTimestamp: Date.now() - 30_000,
      },
    });
    expect(clockSkewed.statusCode).toBe(200);

    const ahead = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 250,
        clientSequence: 3,
        clientTimestamp: Date.now() + 30_000,
      },
    });
    expect(ahead.statusCode).toBe(200);

    // An actually out-of-order request must not move the cursor backwards.
    const newest = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: { ...common, positionSeconds: 400, clientSequence: 5 },
    });
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: { ...common, positionSeconds: 300, clientSequence: 4 },
    });
    expect(newest.statusCode).toBe(200);
    expect(stale.statusCode).toBe(200);

    const [fastOne, fastTwo] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/api/playback/progress',
        cookies: { session_id: sessionCookie!.value },
        payload: { ...common, positionSeconds: 500, clientSequence: 6 },
      }),
      app.inject({
        method: 'PUT',
        url: '/api/playback/progress',
        cookies: { session_id: sessionCookie!.value },
        payload: { ...common, positionSeconds: 600, clientSequence: 7 },
      }),
    ]);
    expect(fastOne.statusCode).toBe(200);
    expect(fastTwo.statusCode).toBe(200);

    await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        mediaItemId: 'media_test_pb_2',
        durationSeconds: 6960,
        positionSeconds: 700,
        clientSequence: 8,
      },
    });
    const episode = await app.prisma.episode.findFirstOrThrow({
      where: { mediaItemId: 'media_test_pb_series' },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        mediaItemId: 'media_test_pb_series',
        episodeId: episode.id,
        durationSeconds: 3600,
        positionSeconds: 900,
        clientSequence: 9,
      },
    });

    expect(
      await app.prisma.playbackProgress.findUnique({
        where: {
          userId_mediaItemId_trackingKey: {
            userId: (await app.authService.ensureAdminUserExists()).id,
            mediaItemId: 'media_test_pb_1',
            trackingKey: '__media__',
          },
        },
      }),
    ).toMatchObject({ positionSeconds: 600, clientSequence: 7 });
    expect(
      await app.prisma.playbackProgress.count({ where: { mediaItemId: 'media_test_pb_2' } }),
    ).toBe(1);
    expect(await app.prisma.playbackProgress.count({ where: { episodeId: episode.id } })).toBe(1);
  });

  it('conflicts a stale same-client sequence and supports an explicit rebase', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');
    const common = {
      mediaItemId: 'media_test_pb_1',
      durationSeconds: 8100,
    };

    const first = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 100,
        clientInstanceId: 'playback-client-a',
        clientSequence: 1,
      },
    });
    const firstRevision = first.json().progress.serverRevision as number;

    // A second client advances the server revision before client A's next
    // request arrives. A's request still has a newer sequence for A, even
    // though it carries the older revision snapshot from response 1.
    const competing = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 200,
        clientInstanceId: 'playback-client-b',
        clientSequence: 1,
        serverRevision: firstRevision,
      },
    });
    expect(competing.statusCode).toBe(200);
    const competingBody = JSON.parse(competing.body) as {
      progress: { positionSeconds: number; serverRevision: number };
    };

    const staleClientA = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 300,
        clientInstanceId: 'playback-client-a',
        clientSequence: 2,
        serverRevision: firstRevision,
      },
    });
    expect(staleClientA.statusCode).toBe(200);
    expect(JSON.parse(staleClientA.body)).toMatchObject({
      conflict: true,
      progress: {
        positionSeconds: competingBody.progress.positionSeconds,
        serverRevision: competingBody.progress.serverRevision,
      },
    });

    await expect(
      app.prisma.playbackProgress.findUnique({
        where: {
          userId_mediaItemId_trackingKey: {
            userId: (await app.authService.ensureAdminUserExists()).id,
            mediaItemId: 'media_test_pb_1',
            trackingKey: '__media__',
          },
        },
      }),
    ).resolves.toMatchObject({
      positionSeconds: 200,
      clientInstanceId: 'playback-client-b',
      clientSequence: 1,
      serverRevision: competingBody.progress.serverRevision,
    });

    const rebased = await app.inject({
      method: 'PUT',
      url: '/api/playback/progress',
      cookies: { session_id: sessionCookie!.value },
      payload: {
        ...common,
        positionSeconds: 300,
        clientInstanceId: 'playback-client-a',
        clientSequence: 2,
        serverRevision: competingBody.progress.serverRevision,
      },
    });
    expect(rebased.statusCode).toBe(200);
    expect(JSON.parse(rebased.body).conflict).toBeUndefined();

    await expect(
      app.prisma.playbackProgress.findUnique({
        where: {
          userId_mediaItemId_trackingKey: {
            userId: (await app.authService.ensureAdminUserExists()).id,
            mediaItemId: 'media_test_pb_1',
            trackingKey: '__media__',
          },
        },
      }),
    ).resolves.toMatchObject({
      positionSeconds: 300,
      clientInstanceId: 'playback-client-a',
      clientSequence: 2,
      serverRevision: competingBody.progress.serverRevision + 1,
    });
  });

  it('does not let a stale high-sequence client roll back canonical progress', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');
    const common = {
      mediaItemId: 'media_test_pb_1',
      durationSeconds: 8100,
    };
    const save = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: '/api/playback/progress',
        cookies: { session_id: sessionCookie!.value },
        payload,
      });

    const first = await save({
      ...common,
      positionSeconds: 100,
      clientInstanceId: 'playback-client-a',
      clientSequence: 1,
    });
    const staleRevision = (JSON.parse(first.body) as { progress: { serverRevision: number } })
      .progress.serverRevision;

    const canonical = await save({
      ...common,
      positionSeconds: 900,
      clientInstanceId: 'playback-client-a',
      clientSequence: 2,
      serverRevision: staleRevision,
    });
    const canonicalRevision = (
      JSON.parse(canonical.body) as { progress: { serverRevision: number } }
    ).progress.serverRevision;

    // Client B has a much higher local sequence, but its snapshot predates
    // the canonical update. Sequence must not bypass the global revision gate.
    const staleHighSequence = await save({
      ...common,
      positionSeconds: 100,
      clientInstanceId: 'playback-client-b',
      clientSequence: 100,
      serverRevision: staleRevision,
    });
    expect(JSON.parse(staleHighSequence.body)).toMatchObject({
      conflict: true,
      progress: {
        positionSeconds: 900,
        serverRevision: canonicalRevision,
      },
    });

    await expect(
      app.prisma.playbackProgress.findUnique({
        where: {
          userId_mediaItemId_trackingKey: {
            userId: (await app.authService.ensureAdminUserExists()).id,
            mediaItemId: 'media_test_pb_1',
            trackingKey: '__media__',
          },
        },
      }),
    ).resolves.toMatchObject({
      positionSeconds: 900,
      clientInstanceId: 'playback-client-a',
      clientSequence: 2,
      serverRevision: canonicalRevision,
    });
    await expect(
      app.prisma.watchHistory.findUnique({
        where: {
          userId_mediaItemId_trackingKey: {
            userId: (await app.authService.ensureAdminUserExists()).id,
            mediaItemId: 'media_test_pb_1',
            trackingKey: '__media__',
          },
        },
      }),
    ).resolves.toMatchObject({ positionSeconds: 900 });
  });

  it('keeps sequence ordering when responses overlap, retry, pause, and unload', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');
    const common = {
      mediaItemId: 'media_test_pb_1',
      durationSeconds: 8100,
      clientInstanceId: 'playback-overlap-client',
    };
    const save = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: '/api/playback/progress',
        cookies: { session_id: sessionCookie!.value },
        payload,
      });

    const first = await save({ ...common, positionSeconds: 100, clientSequence: 1 });
    expect(first.statusCode).toBe(200);
    const firstRevision = (JSON.parse(first.body) as { progress: { serverRevision: number } })
      .progress.serverRevision;

    // The two requests share the same base revision. Exactly one can commit;
    // the other must observe a revision conflict rather than overwrite it.
    const [sequenceTwo, sequenceThree] = await Promise.all([
      save({
        ...common,
        positionSeconds: 200,
        clientSequence: 2,
        serverRevision: firstRevision,
      }),
      save({
        ...common,
        positionSeconds: 300,
        clientSequence: 3,
        serverRevision: firstRevision,
      }),
    ]);
    expect(sequenceTwo.statusCode).toBe(200);
    expect(sequenceThree.statusCode).toBe(200);
    const sequenceTwoBody = JSON.parse(sequenceTwo.body) as { conflict?: boolean };
    const sequenceThreeBody = JSON.parse(sequenceThree.body) as { conflict?: boolean };
    expect(
      Number(Boolean(sequenceTwoBody.conflict)) + Number(Boolean(sequenceThreeBody.conflict)),
    ).toBe(1);

    const progressKey = {
      userId_mediaItemId_trackingKey: {
        userId: (await app.authService.ensureAdminUserExists()).id,
        mediaItemId: 'media_test_pb_1',
        trackingKey: '__media__',
      },
    };
    const afterOverlap = await app.prisma.playbackProgress.findUnique({ where: progressKey });
    expect(afterOverlap).toMatchObject({
      clientInstanceId: common.clientInstanceId,
      serverRevision: firstRevision + 1,
    });
    expect([200, 300]).toContain(afterOverlap?.positionSeconds);
    expect([2, 3]).toContain(afterOverlap?.clientSequence);

    // Retrying the same request is idempotent and must not consume a new
    // server revision or rewrite history with duplicate state.
    const retry = await save({
      ...common,
      positionSeconds: afterOverlap!.positionSeconds,
      clientSequence: afterOverlap!.clientSequence,
      serverRevision: firstRevision,
    });
    expect(JSON.parse(retry.body).conflict).toBeUndefined();
    const afterRetry = await app.prisma.playbackProgress.findUnique({ where: progressKey });
    expect(afterRetry?.serverRevision).toBe(afterOverlap?.serverRevision);
    expect(afterRetry?.positionSeconds).toBe(afterOverlap?.positionSeconds);

    // A genuinely old event must not move either progress or history back.
    const oldEvent = await save({
      ...common,
      positionSeconds: 200,
      clientSequence: 1,
      serverRevision: firstRevision,
    });
    expect(JSON.parse(oldEvent.body).conflict).toBeUndefined();
    const [afterStale, historyAfterStale] = await Promise.all([
      app.prisma.playbackProgress.findUnique({ where: progressKey }),
      app.prisma.watchHistory.findUnique({ where: progressKey }),
    ]);
    expect(afterStale).toMatchObject({
      positionSeconds: afterOverlap?.positionSeconds,
      clientSequence: afterOverlap?.clientSequence,
    });
    expect(historyAfterStale).toMatchObject({ positionSeconds: afterOverlap?.positionSeconds });

    // Pause/unload uses the same monotonic event stream and is allowed to save
    // a lower position when its sequence is newer.
    const pause = await save({
      ...common,
      positionSeconds: 0,
      clientSequence: 4,
      serverRevision: afterRetry!.serverRevision,
    });
    expect(JSON.parse(pause.body).conflict).toBeUndefined();
    expect(await app.prisma.playbackProgress.findUnique({ where: progressKey })).toMatchObject({
      positionSeconds: 0,
      clientSequence: 4,
    });

    // A duplicate delivery of the pause event is a no-op. A later resume is
    // still allowed to move forward from the current revision.
    const pauseRevision = (await app.prisma.playbackProgress.findUnique({ where: progressKey }))!
      .serverRevision;
    const duplicatePause = await save({
      ...common,
      positionSeconds: 0,
      clientSequence: 4,
      serverRevision: pauseRevision - 1,
    });
    expect(JSON.parse(duplicatePause.body).conflict).toBeUndefined();
    const resume = await save({
      ...common,
      positionSeconds: 120,
      clientSequence: 5,
      serverRevision: pauseRevision,
    });
    expect(JSON.parse(resume.body).conflict).toBeUndefined();
    expect(await app.prisma.playbackProgress.findUnique({ where: progressKey })).toMatchObject({
      positionSeconds: 120,
      clientSequence: 5,
    });

    // Sequence state is scoped to the logical media/episode row, not shared
    // globally across a client's catalogue.
    const mediaChange = await save({
      ...common,
      mediaItemId: 'media_test_pb_2',
      durationSeconds: 6960,
      positionSeconds: 700,
      clientSequence: 1,
      serverRevision: 0,
    });
    expect(mediaChange.statusCode).toBe(200);
    const episode = await app.prisma.episode.findFirstOrThrow({
      where: { mediaItemId: 'media_test_pb_series' },
    });
    const episodeChange = await save({
      ...common,
      mediaItemId: 'media_test_pb_series',
      episodeId: episode.id,
      durationSeconds: 3600,
      positionSeconds: 900,
      clientSequence: 1,
      serverRevision: 0,
    });
    expect(episodeChange.statusCode).toBe(200);
    expect(
      await app.prisma.playbackProgress.count({ where: { mediaItemId: 'media_test_pb_2' } }),
    ).toBe(1);
    expect(await app.prisma.playbackProgress.count({ where: { episodeId: episode.id } })).toBe(1);
  });

  it('serializes concurrent clients with serverRevision compare-and-swap', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    const sessionCookie = loginRes.cookies.find((cookie) => cookie.name === 'session_id');
    const save = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: '/api/playback/progress',
        cookies: { session_id: sessionCookie!.value },
        payload,
      });

    const initial = await save({
      mediaItemId: 'media_test_pb_1',
      durationSeconds: 8100,
      positionSeconds: 100,
      clientInstanceId: 'playback-client-a',
      clientSequence: 1,
    });
    const initialRevision = (JSON.parse(initial.body) as { progress: { serverRevision: number } })
      .progress.serverRevision;

    const [clientB, clientC] = await Promise.all([
      save({
        mediaItemId: 'media_test_pb_1',
        durationSeconds: 8100,
        positionSeconds: 200,
        clientInstanceId: 'playback-client-b',
        clientSequence: 1,
        serverRevision: initialRevision,
      }),
      save({
        mediaItemId: 'media_test_pb_1',
        durationSeconds: 8100,
        positionSeconds: 300,
        clientInstanceId: 'playback-client-c',
        clientSequence: 1,
        serverRevision: initialRevision,
      }),
    ]);
    expect(clientB.statusCode).toBe(200);
    expect(clientC.statusCode).toBe(200);
    const clientBBody = JSON.parse(clientB.body) as { conflict?: boolean };
    const clientCBody = JSON.parse(clientC.body) as { conflict?: boolean };
    expect(Number(Boolean(clientBBody.conflict)) + Number(Boolean(clientCBody.conflict))).toBe(1);

    let progress = await app.prisma.playbackProgress.findUnique({
      where: {
        userId_mediaItemId_trackingKey: {
          userId: (await app.authService.ensureAdminUserExists()).id,
          mediaItemId: 'media_test_pb_1',
          trackingKey: '__media__',
        },
      },
    });
    expect(progress?.serverRevision).toBe(initialRevision + 1);
    expect([200, 300]).toContain(progress?.positionSeconds);
    expect(['playback-client-b', 'playback-client-c']).toContain(progress?.clientInstanceId);

    const loser = clientBBody.conflict
      ? { clientInstanceId: 'playback-client-b', positionSeconds: 200 }
      : { clientInstanceId: 'playback-client-c', positionSeconds: 300 };
    const rebased = await save({
      mediaItemId: 'media_test_pb_1',
      durationSeconds: 8100,
      positionSeconds: loser.positionSeconds,
      clientInstanceId: loser.clientInstanceId,
      clientSequence: 1,
      serverRevision: progress!.serverRevision,
    });
    expect(rebased.statusCode).toBe(200);
    expect(JSON.parse(rebased.body).conflict).toBeUndefined();

    progress = await app.prisma.playbackProgress.findUnique({
      where: {
        userId_mediaItemId_trackingKey: {
          userId: (await app.authService.ensureAdminUserExists()).id,
          mediaItemId: 'media_test_pb_1',
          trackingKey: '__media__',
        },
      },
    });
    expect(progress).toMatchObject({
      serverRevision: initialRevision + 2,
      positionSeconds: loser.positionSeconds,
      clientInstanceId: loser.clientInstanceId,
      clientSequence: 1,
    });
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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  SystemMetricsService,
  type RawSystemMetrics,
} from '../src/services/system-metrics.service.js';

describe('system metrics API', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  const userToken = 'system-metrics-regular-user-token';
  const userEmail = 'metrics-user@cinedrive.test';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    adminCookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
    const user = await app.prisma.user.create({
      data: { email: userEmail, name: 'Metrics user', role: 'user' },
    });
    await app.prisma.session.create({
      data: {
        userId: user.id,
        token: userToken,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { email: userEmail } });
    await app.prisma.systemMetricSample.deleteMany();
    await app.close();
  });

  it('requires authentication and administrator access', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/system/metrics' });
    expect(anonymous.statusCode).toBe(401);

    const regularUser = await app.inject({
      method: 'GET',
      url: '/api/system/metrics',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(regularUser.statusCode).toBe(403);
    expect(JSON.parse(regularUser.body).error.code).toBe('ADMIN_REQUIRED');
  });

  it('returns current metrics and bounded five-minute history without host identifiers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/system/metrics',
      cookies: { session_id: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      sampleIntervalSeconds: 60,
      retentionDays: 7,
      sevenDayBandwidth: {
        receivedBytes: expect.any(Number),
        transmittedBytes: expect.any(Number),
        totalBytes: expect.any(Number),
      },
    });
    expect(['container', 'host']).toContain(body.scope);
    expect(body.current.recordedAt).toEqual(expect.any(String));
    expect(body.history.length).toBeGreaterThan(0);
    expect(response.body).not.toContain('interfaceName');
    expect(response.body).not.toContain('databaseUrl');
    expect(response.body).not.toContain(process.cwd());
  });

  it('removes samples older than seven days during collection', async () => {
    const old = await app.prisma.systemMetricSample.create({
      data: { recordedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000) },
    });
    await app.systemMetricsService.capture();
    expect(await app.prisma.systemMetricSample.findUnique({ where: { id: old.id } })).toBeNull();
  });

  it('continues persisted counters across a restart and resets them when the interface changes', async () => {
    await app.prisma.systemMetricSample.deleteMany();
    const baselineAt = new Date('2026-09-04T10:00:00.000Z');
    await app.prisma.systemMetricSample.create({
      data: {
        recordedAt: baselineAt,
        scope: 'host',
        diskReadBytesTotal: 1_000n,
        diskWriteBytesTotal: 2_000n,
        networkReceiveBytesTotal: 3_000n,
        networkTransmitBytesTotal: 4_000n,
        networkInterface: 'eth0',
      },
    });
    const raw: RawSystemMetrics = {
      capturedAt: new Date(baselineAt.getTime() + 60_000),
      scope: 'host',
      cpu: null,
      memoryUsedBytes: 100n,
      memoryTotalBytes: 200n,
      diskUsedBytes: 300n,
      diskTotalBytes: 400n,
      diskReadBytesTotal: 1_600n,
      diskWriteBytesTotal: 3_200n,
      networkReceiveBytesTotal: 4_200n,
      networkTransmitBytesTotal: 5_800n,
      networkInterface: 'eth0',
      temperatureCelsius: null,
    };
    const collector = async () => raw;
    const service = new SystemMetricsService(app.prisma, env.DATABASE_URL, app.log, collector);
    const continued = await service.capture();
    expect(continued).toMatchObject({
      diskReadBytesPerSecond: 10,
      diskWriteBytesPerSecond: 20,
      networkReceiveBytesPerSecond: 20,
      networkTransmitBytesPerSecond: 30,
      networkReceiveBytesDelta: 1_200n,
      networkTransmitBytesDelta: 1_800n,
    });

    const changedInterface = new SystemMetricsService(
      app.prisma,
      env.DATABASE_URL,
      app.log,
      async () => ({
        ...raw,
        capturedAt: new Date(raw.capturedAt.getTime() + 60_000),
        networkInterface: 'ens3',
      }),
    );
    const reset = await changedInterface.capture();
    expect(reset.networkReceiveBytesDelta).toBe(0n);
    expect(reset.networkTransmitBytesDelta).toBe(0n);
  });
});

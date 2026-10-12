import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  CONNECT_COMMAND_CLEANUP_BATCH_SIZE,
  CONNECT_COMMAND_RETENTION_MS,
  MusicConnectMaintenanceService,
} from '../src/services/music-connect-maintenance.service.js';

describe('bounded Connect receipt retention', () => {
  let app: FastifyInstance;
  let userId: string;
  const now = new Date('2026-10-12T12:00:00Z');
  const cutoff = new Date(now.getTime() - CONNECT_COMMAND_RETENTION_MS);
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const user = await app.prisma.user.create({
      data: { email: `${randomUUID()}@retention.test`, name: 'Fixture' },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await app.prisma.user.delete({ where: { id: userId } });
    await app.close();
  });
  const command = (expiresAt: Date, completedAt: Date | null, status = 'completed') => ({
    id: randomUUID(),
    userId,
    sourceClientId: 'source',
    targetClientId: 'target',
    type: 'pause',
    expiresAt,
    completedAt,
    status,
  });
  it('keeps active, recent, boundary and late-acknowledged commands, deleting only stale receipts', async () => {
    const past = new Date(cutoff.getTime() - 1000);
    const recent = new Date(now.getTime() - 1000);
    const stale = [
      command(past, past),
      command(past, past, 'failed'),
      command(past, null, 'pending'),
    ];
    const retained = [
      command(recent, recent),
      command(new Date(now.getTime() + 45_000), null, 'pending'),
      command(cutoff, null),
      command(past, recent),
      command(past, cutoff),
    ];
    await app.prisma.musicPlaybackCommand.createMany({ data: [...stale, ...retained] });
    const service = new MusicConnectMaintenanceService(app.prisma, () => now);
    expect(await service.run()).toBe(stale.length);
    const rows = await app.prisma.musicPlaybackCommand.findMany({
      where: { userId },
      select: { id: true },
    });
    expect(rows.map((row) => row.id).sort()).toEqual(retained.map((row) => row.id).sort());
    await app.prisma.musicPlaybackCommand.deleteMany({ where: { userId } });
  });
  it('uses one safe batch and deduplicates simultaneous cleanup calls', async () => {
    const past = new Date(cutoff.getTime() - 1000);
    await app.prisma.musicPlaybackCommand.createMany({
      data: Array.from({ length: CONNECT_COMMAND_CLEANUP_BATCH_SIZE + 1 }, () =>
        command(past, past),
      ),
    });
    const service = new MusicConnectMaintenanceService(app.prisma, () => now);
    const first = service.run(),
      repeated = service.run();
    expect(repeated).toBe(first);
    expect(await first).toBe(CONNECT_COMMAND_CLEANUP_BATCH_SIZE);
    expect(await service.run()).toBe(1);
    await service.stop();
    expect(await service.run()).toBe(0);
  });
  it('does not delete an old command whose ACK becomes fresh between selection and deletion', async () => {
    const past = new Date(cutoff.getTime() - 1000);
    const fixture = await app.prisma.musicPlaybackCommand.create({
      data: command(past, null, 'pending'),
    });
    const findMany = app.prisma.musicPlaybackCommand.findMany.bind(app.prisma.musicPlaybackCommand);
    const spy = vi
      .spyOn(app.prisma.musicPlaybackCommand, 'findMany')
      .mockImplementationOnce((async (args: Parameters<typeof findMany>[0]) => {
        const result = await findMany(args);
        await app.prisma.musicPlaybackCommand.update({
          where: { id: fixture.id },
          data: { status: 'completed', completedAt: now },
        });
        return result;
      }) as typeof app.prisma.musicPlaybackCommand.findMany);
    try {
      expect(await new MusicConnectMaintenanceService(app.prisma, () => now).run()).toBe(0);
      expect(
        await app.prisma.musicPlaybackCommand.findUnique({ where: { id: fixture.id } }),
      ).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

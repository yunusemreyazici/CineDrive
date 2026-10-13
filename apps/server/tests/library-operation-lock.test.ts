import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('library operation leases', () => {
  let app: FastifyInstance;
  let libraryId: string;
  let closed: boolean;

  beforeEach(async () => {
    app = await buildApp();
    closed = false;
    await app.ready();
    const admin = await app.authService.ensureAdminUserExists();
    const library = await app.prisma.library.create({
      data: {
        userId: admin.id,
        name: `Operation lock ${Date.now()}`,
        storageType: 'local',
        localFolderPath: '/tmp/cinedrive-operation-lock',
      },
    });
    libraryId = library.id;
  });

  afterEach(async () => {
    await app.prisma.library.deleteMany({ where: { id: libraryId } });
    if (closed) await app.prisma.$disconnect();
    else await app.close();
  });

  it('serializes competing operations and allows only the token owner to release', async () => {
    const first = await app.libraryOperationLockService.acquire(libraryId, 'scan');

    await expect(app.libraryOperationLockService.acquire(libraryId, 'clear')).rejects.toThrow(
      'LIBRARY_OPERATION_IN_PROGRESS',
    );
    expect(await first.heartbeat()).toBe(true);

    // A stale token cannot clear a newer lease.
    await app.prisma.library.update({
      where: { id: libraryId },
      data: {
        operationLockToken: 'new-owner',
        operationLockKind: 'clear',
        operationLockExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await first.release();
    expect(
      (await app.prisma.library.findUnique({ where: { id: libraryId } }))?.operationLockToken,
    ).toBe('new-owner');

    await app.prisma.library.update({
      where: { id: libraryId },
      data: { operationLockExpiresAt: new Date(Date.now() - 1_000) },
    });
    const replacement = await app.libraryOperationLockService.acquire(libraryId, 'clear');
    expect(await replacement.heartbeat()).toBe(true);
    await replacement.release();
    expect(
      (await app.prisma.library.findUnique({ where: { id: libraryId } }))?.operationLockToken,
    ).toBeNull();
  });

  it('drains aborted execution and releases its lease before database disconnect', async () => {
    const scan = await app.prisma.libraryScan.create({
      data: { libraryId, status: 'running', heartbeatAt: new Date() },
    });
    const lock = await app.libraryOperationLockService.acquire(libraryId, 'scan');
    const signal = app.scanLifecycleService.register(
      scan.id,
      libraryId,
      [],
      undefined,
      lock.heartbeat,
    );
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const events: string[] = [];
    const execution = pending.finally(async () => {
      await lock.release();
      events.push('lease-released');
    });
    app.scanLifecycleService.trackExecution(scan.id, execution);
    const disconnect = app.prisma.$disconnect.bind(app.prisma);
    const spy = vi.spyOn(app.prisma, '$disconnect').mockImplementation(async () => {
      events.push('db-disconnected');
      await disconnect();
    });
    try {
      const closing = app.close();
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      expect(spy).not.toHaveBeenCalled();
      await expect(app.libraryOperationLockService.acquire(libraryId, 'scan')).rejects.toThrow(
        'LIBRARY_OPERATION_IN_PROGRESS',
      );
      expect(
        await app.prisma.libraryScan.findUniqueOrThrow({ where: { id: scan.id } }),
      ).toMatchObject({ status: 'interrupted', interruptionReason: 'server_shutdown' });
      complete();
      await closing;
      closed = true;
      expect(events).toEqual(['lease-released', 'db-disconnected']);
      spy.mockRestore();
      await app.prisma.$connect();
      expect(
        await app.prisma.library.findUniqueOrThrow({ where: { id: libraryId } }),
      ).toMatchObject({ operationLockToken: null, operationLockKind: null });
      // A subsequent process can acquire immediately, not after a ten-minute TTL.
      const next = await app.libraryOperationLockService.acquire(libraryId, 'scan');
      await next.release();
    } finally {
      complete();
      vi.restoreAllMocks();
    }
  });

  it.each(['clear', 'delete'] as const)(
    'interrupts a scan when a replacement %s operation takes the lease',
    async (replacementKind) => {
      const scan = await app.prisma.libraryScan.create({
        data: { libraryId, status: 'running', heartbeatAt: new Date() },
      });
      const scanLock = await app.libraryOperationLockService.acquire(libraryId, 'scan');
      const signal = app.scanLifecycleService.register(
        scan.id,
        libraryId,
        [],
        undefined,
        scanLock.heartbeat,
      );

      await app.prisma.library.update({
        where: { id: libraryId },
        data: {
          operationLockToken: `replacement-${replacementKind}`,
          operationLockKind: replacementKind,
          operationLockExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      await expect(app.scanLifecycleService.heartbeat(scan.id)).rejects.toMatchObject({
        reason: 'library_operation_lost',
      });
      expect(signal.aborted).toBe(true);
      expect(await app.prisma.libraryScan.findUnique({ where: { id: scan.id } })).toMatchObject({
        status: 'interrupted',
        interruptionReason: 'library_operation_lost',
      });

      // The old scan's finally block may still release its stale token, but it
      // must not clear the replacement operation.
      await scanLock.release();
      expect(
        (await app.prisma.library.findUnique({ where: { id: libraryId } }))?.operationLockToken,
      ).toBe(`replacement-${replacementKind}`);
    },
  );
});

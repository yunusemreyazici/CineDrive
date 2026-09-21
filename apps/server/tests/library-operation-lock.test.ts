import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('library operation leases', () => {
  let app: FastifyInstance;
  let libraryId: string;

  beforeEach(async () => {
    app = await buildApp();
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
    await app.close();
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
});

import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { PrismaClient } from '@cinedrive/prisma';
import {
  ScanInterruptedError,
  ScanLifecycleService,
} from '../src/services/scan-lifecycle.service.js';

describe('scan lifecycle lease loss', () => {
  it('does not refresh the SQLite lease for every scan item', async () => {
    const leaseHeartbeat = vi.fn().mockResolvedValue(true);
    const scanHeartbeat = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      libraryScan: { updateMany: scanHeartbeat },
    } as unknown as PrismaClient;
    const lifecycle = new ScanLifecycleService(prisma);
    lifecycle.register('scan-1', 'library-1', [], undefined, leaseHeartbeat);

    await lifecycle.heartbeat('scan-1', true);
    await Promise.all(
      Array.from({ length: 1_000 }, () => lifecycle.heartbeat('scan-1')),
    );

    expect(leaseHeartbeat).toHaveBeenCalledOnce();
    expect(scanHeartbeat).toHaveBeenCalledOnce();
  });

  it('refreshes a long-running scan before the lease interval elapses', async () => {
    const performanceNow = vi.spyOn(performance, 'now');
    try {
      performanceNow.mockReturnValue(1_000);
      const leaseHeartbeat = vi.fn().mockResolvedValue(true);
      const prisma = {
        libraryScan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      } as unknown as PrismaClient;
      const lifecycle = new ScanLifecycleService(prisma);
      lifecycle.register('scan-1', 'library-1', [], undefined, leaseHeartbeat);

      await lifecycle.heartbeat('scan-1', true);
      performanceNow.mockReturnValue(6_001);
      await lifecycle.heartbeat('scan-1');

      expect(leaseHeartbeat).toHaveBeenCalledTimes(2);
    } finally {
      performanceNow.mockRestore();
    }
  });

  it('hard-stops when the lease heartbeat database write fails', async () => {
    const leaseHeartbeat = vi.fn().mockRejectedValue(new Error('SQLITE_BUSY'));
    const prisma = {
      libraryScan: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaClient;
    const lifecycle = new ScanLifecycleService(prisma);
    const signal = lifecycle.register('scan-1', 'library-1', [], undefined, leaseHeartbeat);

    await expect(lifecycle.heartbeat('scan-1', true)).rejects.toMatchObject({
      reason: 'library_operation_lost',
    });
    expect(signal.aborted).toBe(true);
    expect(leaseHeartbeat).toHaveBeenCalledOnce();
    expect(prisma.libraryScan.updateMany).not.toHaveBeenCalled();
  });

  it('aborts the scan, finalizes it as interrupted, and does not swallow the loss', async () => {
    const libraryScanUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const sourceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      libraryScan: { updateMany: libraryScanUpdateMany },
      driveScanSource: { updateMany: sourceUpdateMany },
    };
    const prisma = {
      libraryScan: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'scan-1',
          libraryId: 'library-1',
          driveScanSourceId: 'source-1',
          startedAt: new Date(0),
        }),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;
    const interrupted = vi.fn();
    const lifecycle = new ScanLifecycleService(prisma);
    const signal = lifecycle.register(
      'scan-1',
      'library-1',
      ['source-1'],
      interrupted,
      async () => false,
    );

    await expect(lifecycle.heartbeat('scan-1', true)).rejects.toBeInstanceOf(ScanInterruptedError);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(ScanInterruptedError);
    expect(interrupted).toHaveBeenCalledOnce();
    expect(lifecycle.isScanActive('scan-1')).toBe(false);
    expect(libraryScanUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'scan-1', status: 'running' },
        data: expect.objectContaining({
          status: 'interrupted',
          interruptionReason: 'library_operation_lost',
        }),
      }),
    );
    expect(sourceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastScanStatus: 'interrupted',
          lastScanInterruptionReason: 'library_operation_lost',
        }),
      }),
    );
  });
});

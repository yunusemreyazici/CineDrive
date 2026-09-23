import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@cinedrive/prisma';
import { MetadataEnrichmentService } from '../src/services/metadata-enrichment.service.js';

describe('metadata enrichment queue', () => {
  it('merges newly discovered work without resetting a pending retry', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn();
    const nextAttemptAt = new Date(Date.now() + 60_000);
    const prisma = {
      metadataEnrichmentJob: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'job',
            mediaItemId: 'media',
            status: 'pending',
            year: null,
            seriesId: 'series',
            refreshMedia: true,
            refreshEpisodes: false,
            nextAttemptAt,
          },
        ]),
        updateMany,
        createMany,
      },
    } as unknown as PrismaClient;
    const service = new MetadataEnrichmentService(prisma);
    await service.stop(); // No worker/provider calls are needed for enqueueing.

    await service.enqueueAfterIndexing([
      {
        libraryId: 'library',
        mediaItemId: 'media',
        title: 'Series',
        type: 'series',
        refreshMedia: false,
        refreshEpisodes: true,
        seriesId: 'series',
      },
    ]);

    expect(createMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job', status: 'pending' },
      data: expect.objectContaining({ refreshMedia: true, refreshEpisodes: true }),
    });
    expect(updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('nextAttemptAt');
  });

  it('backs off provider failures and stops after the attempt limit', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      attempts: 1,
      status: 'running',
      leaseToken: 'lease',
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { metadataEnrichmentJob: { findUnique, updateMany } } as unknown as PrismaClient;
    const service = new MetadataEnrichmentService(prisma);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const before = Date.now();
      await service['scheduleRetry'](
        'job',
        'lease',
        new Error('PROVIDER_429'),
        new AbortController().signal,
      );
      const retry = updateMany.mock.calls[0]?.[0];
      expect(retry.data.status).toBe('pending');
      expect(retry.data.lastError).toBe('Error');
      expect(retry.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);

      findUnique.mockResolvedValue({ attempts: 8, status: 'running', leaseToken: 'lease' });
      await service['scheduleRetry'](
        'job',
        'lease',
        new Error('PROVIDER_429'),
        new AbortController().signal,
      );
      expect(updateMany.mock.calls[1]?.[0].data.status).toBe('failed');
    } finally {
      warn.mockRestore();
    }
  });
});

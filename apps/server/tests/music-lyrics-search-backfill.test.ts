import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@cinedrive/prisma';
import { buildApp } from '../src/app.js';
import * as lyricsSearch from '../src/services/music-lyrics-search.service.js';
import { MusicLyricsSearchBackfillService } from '../src/services/music-lyrics-search-backfill.service.js';

describe('background lyrics index lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules one worker, never blocks start, and drains an aborted active batch', async () => {
    let finish!: () => void;
    const batch = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run = vi.fn((_signal: AbortSignal) => batch);
    const completed = vi.fn();
    const service = new MusicLyricsSearchBackfillService(run, completed);
    service.start();
    service.start();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    const signal = run.mock.calls[0]![0];
    let stopped = false;
    const shutdown = service.stop().then(() => {
      stopped = true;
    });
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await shutdown;
    expect(completed).not.toHaveBeenCalled();
    service.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled worker before it performs any work', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const service = new MusicLyricsSearchBackfillService(run);
    service.start();
    await service.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries failures with bounded backoff, then completes only once', async () => {
    const run = vi.fn().mockRejectedValue(new Error('fixture DB failure'));
    const complete = vi.fn(),
      error = vi.fn();
    const service = new MusicLyricsSearchBackfillService(run, complete, error);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const previous = run.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(run).toHaveBeenCalledTimes(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(previous + 1);
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(error).toHaveBeenCalledTimes(7);
    run.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(complete).toHaveBeenCalledTimes(1);
    service.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
    await service.stop();
  });

  it('cancels retry timers and suppresses failures during shutdown', async () => {
    const error = vi.fn();
    const failing = new MusicLyricsSearchBackfillService(
      vi.fn().mockRejectedValue(new Error('fixture')),
      undefined,
      error,
    );
    failing.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledTimes(1);
    await failing.stop();
    expect(vi.getTimerCount()).toBe(0);
    let reject!: (error: Error) => void;
    const running = new MusicLyricsSearchBackfillService(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
      undefined,
      error,
    );
    running.start();
    await vi.advanceTimersByTimeAsync(0);
    const stop = running.stop();
    reject(new Error('shutdown fixture'));
    await stop;
    expect(error).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('non-blocking real server startup', () => {
  let app: FastifyInstance | undefined;
  let release = () => {};
  afterEach(async () => {
    release();
    await app?.close();
    vi.restoreAllMocks();
  });

  it('serves health/readiness while indexing is pending and drains before disconnect', async () => {
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No external provider permitted'));
    let announce!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const events: string[] = [];
    const run = vi
      .spyOn(lyricsSearch, 'backfillLyricsSearch')
      .mockImplementation(async (_prisma, cancellation) => {
        signal = cancellation;
        announce();
        await pending;
        events.push('index-drained');
      });
    app = await buildApp();
    // Deterministic regression: the old awaited onReady hook starts the pending
    // index first; the new version finishes ready without starting any index.
    const readiness = app.ready();
    expect(
      await Promise.race([
        readiness.then(() => 'core-ready'),
        started.then(() => 'index-inside-ready'),
      ]),
    ).toBe('core-ready');
    expect(run).not.toHaveBeenCalled();
    const disconnect = app.prisma.$disconnect.bind(app.prisma);
    const disconnectSpy = vi.spyOn(app.prisma, '$disconnect').mockImplementation(async () => {
      events.push('database-disconnected');
      await disconnect();
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await started;
    expect(run).toHaveBeenCalledTimes(1);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
    const closing = app.close();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(disconnectSpy).not.toHaveBeenCalled();
    release();
    await closing;
    expect(events).toEqual(['index-drained', 'database-disconnected']);
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps the API available if indexing fails, without an unhandled rejection', async () => {
    const run = vi
      .spyOn(lyricsSearch, 'backfillLyricsSearch')
      .mockRejectedValue(new Error('fixture index unavailable'));
    app = await buildApp();
    const warn = vi.spyOn(app.log, 'warn');
    await app.listen({ port: 0, host: '127.0.0.1' });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Lyrics search backfill failed; will retry in background'),
    );
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
    await app.close();
  });
});

describe('large bounded index backfill', () => {
  it('finishes an already-started transaction but does not select another batch after abort', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return 1;
    });
    const find = vi.fn().mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        content: '[00:01]Eski sözlerin ışığı',
      })),
    );
    const transaction = vi.fn(
      async (work: (tx: { $executeRaw: typeof execute }) => Promise<void>) => {
        await work({ $executeRaw: execute });
      },
    );
    const prisma = {
      musicLyrics: { findMany: find },
      $transaction: transaction,
    } as unknown as PrismaClient;
    await lyricsSearch.backfillLyricsSearch(prisma, controller.signal);
    expect(find).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(10);
  });

  it('processes 10,000 simulated old lyrics with ten-row batches and no provider traffic', async () => {
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No external provider permitted'));
    const execute = vi.fn().mockResolvedValue(1);
    const find = vi.fn(async (args: { take: number; where: { id?: { gt: string } } }) => {
      expect(args.take).toBe(10);
      const cursor = Number(args.where.id?.gt ?? 0);
      return Array.from({ length: Math.min(10, 10_000 - cursor) }, (_, i) => ({
        id: String(cursor + i + 1).padStart(5, '0'),
        content: '[00:01]Eski sözlerin ışığı',
      }));
    });
    const transaction = vi.fn(
      async (work: (tx: { $executeRaw: typeof execute }) => Promise<void>) => {
        await work({ $executeRaw: execute });
      },
    );
    // Narrow test double models only the backfill's Prisma methods. No entire
    // 10k fixture list is materialized or written to a real/user database.
    const prisma = {
      musicLyrics: { findMany: find },
      $transaction: transaction,
    } as unknown as PrismaClient;
    try {
      await lyricsSearch.backfillLyricsSearch(prisma);
      expect(find).toHaveBeenCalledTimes(1001);
      expect(transaction).toHaveBeenCalledTimes(1000);
      expect(execute).toHaveBeenCalledTimes(10_000);
      expect(provider).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

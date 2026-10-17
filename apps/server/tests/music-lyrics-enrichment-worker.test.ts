import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@cinedrive/prisma';
import { envSchema } from '@cinedrive/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { MusicLanguageEnrichmentService } from '../src/services/music-language-enrichment.service.js';
import { MusicLyricsEnrichmentWorker } from '../src/services/music-lyrics-enrichment-worker.service.js';
import { MusicLyricsService } from '../src/services/music-lyrics.service.js';
import { searchLyrics } from '../src/services/music-lyrics-search.service.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('periodic missing lyrics lifecycle', () => {
  it('defaults to five minutes, supports disabling, and rejects unsafe intervals', () => {
    const schema = envSchema.pick({ MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES: true });
    expect(schema.parse({}).MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES).toBe(5);
    expect(
      schema.parse({ MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES: '0' })
        .MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES,
    ).toBe(0);
    for (const value of [-1, 0.5, 1441, 'invalid'])
      expect(schema.safeParse({ MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES: value }).success).toBe(
        false,
      );
  });

  it('delays startup, never overlaps, drains on shutdown and never restarts', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = new MusicLyricsEnrichmentWorker(run, 300_000);
    worker.start();
    worker.start();
    expect(worker.observation.snapshot()).toMatchObject({
      status: 'queued',
      startedAt: null,
      estimatedRemainingSeconds: null,
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(worker.observation.snapshot()).toMatchObject({
      status: 'running',
      startedAt: expect.any(String),
      nextRunAt: null,
    });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = worker.stop().then(() => {
      stopped = true;
    });
    expect(run.mock.calls[0]![0].aborted).toBe(true);
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await stop;
    expect(worker.observation.snapshot()).toMatchObject({ status: 'stopped', nextRunAt: null });
    worker.start();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('repeats bounded passes and retries DB failures with capped backoff', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValue(new Error('mock DB failure'));
    const error = vi.fn();
    const worker = new MusicLyricsEnrichmentWorker(run, 300_000, error);
    worker.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker.observation.snapshot()).toMatchObject({
      status: 'retryWaiting',
      failures: 1,
      completedAt: expect.any(String),
      nextRunAt: expect.any(String),
    });
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      const calls = run.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(run).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(calls + 1);
    }
    expect(error).toHaveBeenCalledTimes(7);
    run.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(9);
    await worker.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disabled/scheduled workers do not run or call a provider', async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const disabled = new MusicLyricsEnrichmentWorker(run, 0);
    const scheduled = new MusicLyricsEnrichmentWorker(run, 300_000);
    disabled.start();
    scheduled.start();
    await scheduled.stop();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(run).not.toHaveBeenCalled();
    await disabled.stop();
  });
});

describe('bounded catalogue lyrics queue', () => {
  it('uses one 25-row metadata-only query for a 10k catalogue, including known/manual languages', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real provider'));
    const findMany = vi.fn(async (args: { take: number }) => {
      expect(args.take).toBe(25);
      return Array.from({ length: Math.min(args.take, 10_000) }, (_, i) => ({
        id: `track-${i}`,
        title: 'Fixture',
        duration: 180,
        lyricsEnrichmentAttempts: 0,
        primaryArtist: { name: 'Artist' },
        album: { title: 'Album' },
      }));
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const lookupOnlineLyrics = vi.fn().mockResolvedValue({ status: 'found' });
    const prisma = { musicTrack: { findMany, updateMany } } as unknown as PrismaClient;
    const result = await new MusicLanguageEnrichmentService(prisma, {
      lookupOnlineLyrics,
    }).enrichMissingCatalogueLyrics(new AbortController().signal);
    expect(result.providerLookups).toBe(25);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]![0];
    expect(JSON.stringify(args)).not.toContain('languageCode');
    expect(JSON.stringify(args)).not.toContain('languageSource');
    expect(JSON.stringify(args)).not.toContain('content');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not call the provider for rows claimed by another worker', async () => {
    const prisma = {
      musicTrack: {
        findMany: vi.fn().mockResolvedValue([{ id: 'claimed', lyricsEnrichmentAttempts: 0 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaClient;
    const lookupOnlineLyrics = vi.fn();
    const result = await new MusicLanguageEnrichmentService(prisma, {
      lookupOnlineLyrics,
    }).enrichMissingCatalogueLyrics(new AbortController().signal);
    expect(result.providerLookups).toBe(0);
    expect(lookupOnlineLyrics).not.toHaveBeenCalled();
  });

  it('stops claiming rows on shutdown, with at most two lookups in flight', async () => {
    const controller = new AbortController();
    const prisma = {
      musicTrack: {
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 25 }, (_, i) => ({
            id: `track-${i}`,
            title: 'Fixture',
            duration: 180,
            lyricsEnrichmentAttempts: 0,
            primaryArtist: { name: 'Artist' },
            album: { title: 'Album' },
          })),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaClient;
    const lookupOnlineLyrics = vi.fn(async () => {
      controller.abort();
      await Promise.resolve();
      return { status: 'not_found' as const };
    });
    await new MusicLanguageEnrichmentService(prisma, {
      lookupOnlineLyrics,
    }).enrichMissingCatalogueLyrics(controller.signal);
    expect(lookupOnlineLyrics.mock.calls.length).toBeLessThanOrEqual(2);
    expect(lookupOnlineLyrics.mock.calls.length).toBeGreaterThan(0);
    lookupOnlineLyrics.mockClear();
    await new MusicLanguageEnrichmentService(prisma, {
      lookupOnlineLyrics,
    }).enrichMissingCatalogueLyrics(controller.signal);
    expect(lookupOnlineLyrics).not.toHaveBeenCalled();
  });

  it('selects only eligible rows, preserves manual language and makes fetched original lyrics searchable', async () => {
    const http = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real provider'));
    const app = await buildApp();
    await app.ready();
    const owner = await app.prisma.user.create({
      data: {
        email: `${randomUUID()}@test.invalid`,
        name: 'Queue fixture',
        passwordHash: 'unused',
        role: 'user',
      },
    });
    try {
      const library = await app.prisma.library.create({
        data: {
          userId: owner.id,
          name: 'Queue fixture',
          storageType: 'local',
          rootFolderId: '',
        },
      });
      const artist = await app.prisma.musicArtist.create({
        data: {
          userId: owner.id,
          name: 'Queue artist',
          normalizedName: 'queue artist',
        },
      });
      const album = await app.prisma.musicAlbum.create({
        data: {
          userId: owner.id,
          title: 'Queue album',
          normalizedTitle: 'queue album',
          artistId: artist.id,
        },
      });
      const create = async (title: string, status = 'active', duration = 180) => {
        const file = await app.prisma.driveFile.create({
          data: {
            libraryId: library.id,
            name: `${randomUUID()}.mp3`,
            mimeType: 'audio/mpeg',
            status,
          },
        });
        return app.prisma.musicTrack.create({
          data: {
            libraryId: library.id,
            driveFileId: file.id,
            primaryArtistId: artist.id,
            albumId: album.id,
            title,
            normalizedTitle: title.toLowerCase(),
            duration,
            languageCode: 'tr',
            languageSource: 'manual',
            languageConfidence: 1,
          },
        });
      };
      const eligible = await create('Known manual language');
      const english = await create('Known English');
      await app.prisma.musicTrack.update({
        where: { id: english.id },
        data: {
          languageCode: 'en',
          languageSource: 'genre',
        },
      });
      const unknown = await create('Unknown language');
      await app.prisma.musicTrack.update({
        where: { id: unknown.id },
        data: {
          languageCode: null,
          languageSource: null,
        },
      });
      const due = await create('Due retry');
      await app.prisma.musicTrack.update({
        where: { id: due.id },
        data: {
          lyricsEnrichmentStatus: 'not_found',
          lyricsEnrichmentRetryAt: new Date(0),
        },
      });
      const stale = await create('Abandoned lease');
      await app.prisma.musicTrack.update({
        where: { id: stale.id },
        data: {
          lyricsEnrichmentStatus: 'processing',
          lyricsEnrichmentUpdatedAt: new Date(0),
        },
      });
      const fresh = await create('Active lease');
      await app.prisma.musicTrack.update({
        where: { id: fresh.id },
        data: {
          lyricsEnrichmentStatus: 'processing',
          lyricsEnrichmentUpdatedAt: new Date(),
        },
      });
      const notFound = await create('No provider match');
      const failed = await create('Provider failure');
      const cached = await create('Cached');
      await new MusicLyricsService(app.prisma).syncTrackLyrics({
        trackId: cached.id,
        content: 'Existing original words',
        sourceName: 'fixture.lrc',
      });
      const cooldown = await create('Future cooldown');
      await app.prisma.musicTrack.update({
        where: { id: cooldown.id },
        data: {
          lyricsEnrichmentStatus: 'not_found',
          lyricsEnrichmentRetryAt: new Date(Date.now() + 86_400_000),
        },
      });
      await create('Inactive', 'missing');
      await create('No duration', 'active', 0);
      const lyrics = new MusicLyricsService(app.prisma);
      const lookupOnlineLyrics = vi.fn(async (input: { trackId: string }) => {
        if (input.trackId === notFound.id) return { status: 'not_found' as const };
        if (input.trackId === failed.id) throw new Error('Mock provider failure');
        await lyrics.syncTrackLyrics({
          trackId: input.trackId,
          content: '[00:01]Gözlerin geceyi aydınlatır',
          sourceName: 'LRCLIB mock',
          sourceType: 'lrclib',
        });
        return { status: 'found' as const };
      });
      const service = new MusicLanguageEnrichmentService(app.prisma, { lookupOnlineLyrics });
      const results = await Promise.all([
        service.enrichMissingCatalogueLyrics(new AbortController().signal),
        service.enrichMissingCatalogueLyrics(new AbortController().signal),
      ]);
      expect(results.reduce((sum, result) => sum + result.providerLookups, 0)).toBe(7);
      const lookedUp = lookupOnlineLyrics.mock.calls.map(([input]) => input.trackId);
      expect(new Set(lookedUp).size).toBe(7);
      expect(lookedUp).toEqual(
        expect.arrayContaining([
          eligible.id,
          english.id,
          unknown.id,
          due.id,
          stale.id,
          notFound.id,
          failed.id,
        ]),
      );
      const saved = await app.prisma.musicTrack.findUniqueOrThrow({ where: { id: eligible.id } });
      expect(saved).toMatchObject({
        languageCode: 'tr',
        languageSource: 'manual',
        languageConfidence: 1,
      });
      expect(
        (await searchLyrics(app.prisma, owner.id, 'gozlerin geceyi')).map(({ track }) => track.id),
      ).toContain(eligible.id);
      expect(
        await app.prisma.musicTrack.findUniqueOrThrow({ where: { id: notFound.id } }),
      ).toMatchObject({ lyricsEnrichmentStatus: 'not_found', lyricsEnrichmentAttempts: 1 });
      const retry = await app.prisma.musicTrack.findUniqueOrThrow({ where: { id: failed.id } });
      expect(retry).toMatchObject({
        lyricsEnrichmentStatus: 'failed',
        lyricsEnrichmentAttempts: 1,
      });
      expect(retry.lyricsEnrichmentRetryAt!.getTime()).toBeGreaterThan(Date.now());
      const before = await app.prisma.musicLyrics.findUniqueOrThrow({
        where: { trackId: cached.id },
      });
      await lyrics.syncTrackLyrics({
        trackId: cached.id,
        content: 'Provider replacement',
        sourceName: 'LRCLIB mock',
        sourceType: 'lrclib',
      });
      const after = await app.prisma.musicLyrics.findUniqueOrThrow({
        where: { trackId: cached.id },
      });
      expect(after.content).toBe(before.content);
      expect(after.sourceName).toBe(before.sourceName);
      expect(after.searchText).toBe(before.searchText);
      expect(
        (await service.enrichMissingCatalogueLyrics(new AbortController().signal)).providerLookups,
      ).toBe(0);
      // Identity matches are irrelevant: a disabled owner must not be enriched.
      await create('Disabled owner');
      await app.prisma.user.update({ where: { id: owner.id }, data: { disabledAt: new Date() } });
      expect(
        (await service.enrichMissingCatalogueLyrics(new AbortController().signal)).providerLookups,
      ).toBe(0);
      expect(http).not.toHaveBeenCalled();
    } finally {
      await app.prisma.user.delete({ where: { id: owner.id } });
      await app.close();
    }
  });
});

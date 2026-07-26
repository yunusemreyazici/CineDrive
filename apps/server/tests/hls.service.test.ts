import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HlsService } from '../src/services/hls.service';
import { HlsCacheStore } from '../src/services/hls-cache-store';
import { HlsSlotScheduler, NORMAL_PRIORITY, SEEK_PRIORITY } from '../src/services/hls-slot-scheduler';
import { selectProfile, videoOptions } from '../src/services/hls-encoder';

const temporaryDirectories: string[] = [];

const createService = (maxCacheBytes: number) => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cinedrive-hls-test-'));
  temporaryDirectories.push(cacheRoot);
  return new HlsService({ cacheRoot, maxCacheBytes, maxActiveJobs: 2 });
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('HlsService cache management', () => {
  it('marks the initial mobile playlist ready after its first complete segment', () => {
    const service = createService(1024);
    const playlistPath = path.join(service.getCacheDir('mobile-startup'), 'index.m3u8');
    fs.mkdirSync(path.dirname(playlistPath), { recursive: true });
    fs.writeFileSync(
      playlistPath,
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nsegment-000000.m4s\n',
    );

    const cache = new HlsCacheStore(service.getCacheDir('x').replace(/\/[^/]+$/, ''), 1024);

    expect(cache.isReady(playlistPath)).toBe(true);
  });

  it('does not reuse an interrupted playlist that only contains ENDLIST', async () => {
    const service = createService(1024);
    const staleDirectory = service.getCacheDir('stale');
    fs.mkdirSync(staleDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(staleDirectory, 'index.m3u8'),
      '#EXTM3U\n#EXTINF:4,\nsegment-000000.m4s\n#EXT-X-ENDLIST\n',
    );
    let inputRequested = false;

    await expect(
      service.ensureHls('stale', async () => {
        inputRequested = true;
        throw new Error('FRESH_INPUT_REQUESTED');
      }),
    ).rejects.toThrow('FRESH_INPUT_REQUESTED');

    expect(inputRequested).toBe(true);
    expect(fs.existsSync(staleDirectory)).toBe(false);
  });

  it('evicts the least recently used completed cache when over quota', () => {
    const service = createService(10);
    const oldDirectory = service.getCacheDir('old');
    const recentDirectory = service.getCacheDir('recent');

    fs.mkdirSync(oldDirectory, { recursive: true });
    fs.mkdirSync(recentDirectory, { recursive: true });
    fs.writeFileSync(path.join(oldDirectory, 'segment-000000.m4s'), '12345678');
    fs.writeFileSync(path.join(recentDirectory, 'segment-000000.m4s'), 'abcdefgh');

    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(oldDirectory, oldTime, oldTime);
    service.resolveAsset('recent', 'segment-000000.m4s');
    service.enforceCacheQuota();

    expect(fs.existsSync(oldDirectory)).toBe(false);
    expect(fs.existsSync(recentDirectory)).toBe(true);
    expect(service.getStats()).toMatchObject({
      cacheEntries: 1,
      cacheBytes: 8,
      maxCacheBytes: 10,
      maxActiveJobs: 2,
    });
  });

  it('keeps only the three most recent seek caches for one episode', () => {
    const service = createService(1024 * 1024);
    const familyKey = 'episode-fingerprint';
    const cacheKeys = [
      familyKey,
      `${familyKey}-at-100`,
      `${familyKey}-at-200`,
      `${familyKey}-at-300`,
    ];

    cacheKeys.forEach((cacheKey, index) => {
      const directory = service.getCacheDir(cacheKey);
      fs.mkdirSync(directory, { recursive: true });
      const accessMarker = path.join(directory, '.access');
      fs.writeFileSync(accessMarker, '');
      const accessTime = new Date(Date.now() - (cacheKeys.length - index) * 1000);
      fs.utimesSync(accessMarker, accessTime, accessTime);
    });

    service.enforceFamilyCacheLimit(familyKey, `${familyKey}-at-300`);

    expect(fs.existsSync(service.getCacheDir(familyKey))).toBe(false);
    expect(fs.existsSync(service.getCacheDir(`${familyKey}-at-100`))).toBe(true);
    expect(fs.existsSync(service.getCacheDir(`${familyKey}-at-200`))).toBe(true);
    expect(fs.existsSync(service.getCacheDir(`${familyKey}-at-300`))).toBe(true);
  });

  it('rejects unsafe cache and asset names', () => {
    const service = createService(1024);

    expect(() => service.getCacheDir('../escape')).toThrow('INVALID_HLS_KEY');
    expect(() => service.resolveAsset('safe', '../secret')).toThrow('INVALID_HLS_ASSET');
  });

  it('stops an active encoder when its final player session is released', () => {
    const service = createService(1024);
    const kill = vi.fn();
    const idleTimer = setInterval(() => {}, 60_000);
    idleTimer.unref();
    const cacheKey = 'episode-session';

    (
      service as unknown as {
        jobs: Map<string, unknown>;
        leases: Map<string, Set<string>>;
      }
    ).jobs.set(cacheKey, {
      id: 'job-session',
      command: { kill },
      ready: Promise.resolve(),
      familyKey: cacheKey,
      mediaName: 'Test Episode.mkv',
      pid: 1234,
      startSeconds: 0,
      startedAt: Date.now(),
      lastAccessAt: Date.now(),
      idleTimer,
      profile: 'video-copy-aac',
      lastRequestedSegment: -1,
      isPaused: false,
    });
    (
      service as unknown as {
        leases: Map<string, Set<string>>;
      }
    ).leases.set(cacheKey, new Set(['player_session_1', 'player_session_2']));

    expect(service.releaseHls(cacheKey, 'player_session_1')).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    expect(service.releaseHls(cacheKey, 'player_session_2')).toBe(true);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(service.getStats().activeJobs).toBe(0);
  });

  it('does not let a stopped encoder detach its back-navigation replacement', () => {
    const service = createService(1024);
    const oldCommand = { kill: vi.fn() };
    const replacementCommand = { kill: vi.fn() };
    const replacementTimer = setInterval(() => {}, 60_000);
    replacementTimer.unref();
    const cacheKey = 'back-navigation-race';
    const internals = service as unknown as {
      jobs: Map<string, unknown>;
      leases: Map<string, Set<string>>;
      detachJob: (key: string, command: unknown) => string;
    };

    internals.jobs.set(cacheKey, {
      id: 'replacement-job',
      command: replacementCommand,
      ready: Promise.resolve(),
      familyKey: cacheKey,
      mediaName: 'Replacement Episode.mkv',
      pid: 5678,
      startSeconds: 300,
      startedAt: Date.now(),
      lastAccessAt: Date.now(),
      idleTimer: replacementTimer,
      profile: 'h264-aac',
    });
    internals.leases.set(cacheKey, new Set(['replacement_session']));

    expect(internals.detachJob(cacheKey, oldCommand)).toBe('replaced');
    expect(service.getStats().activeJobs).toBe(1);
    expect(internals.leases.get(cacheKey)).toEqual(new Set(['replacement_session']));

    service.shutdown();
  });

  it('reports job details and prevents a stopped Safari session from restarting it', async () => {
    const service = createService(1024);
    const kill = vi.fn();
    const idleTimer = setInterval(() => {}, 60_000);
    idleTimer.unref();
    const internals = service as unknown as {
      jobs: Map<string, unknown>;
      leases: Map<string, Set<string>>;
    };

    internals.jobs.set('observable-cache', {
      id: 'observable-job',
      command: { kill },
      ready: Promise.resolve(),
      familyKey: 'observable-cache',
      mediaName: 'Observable Episode.mkv',
      pid: 4321,
      startSeconds: 125,
      startedAt: Date.now() - 5_000,
      lastAccessAt: Date.now(),
      idleTimer,
      profile: 'video-copy-aac',
      lastRequestedSegment: -1,
      isPaused: false,
    });
    internals.leases.set('observable-cache', new Set(['viewer_one', 'viewer_two']));

    expect(service.getJobs()).toEqual([
      expect.objectContaining({
        id: 'observable-job',
        cacheKey: 'observable-cache',
        mediaName: 'Observable Episode.mkv',
        pid: 4321,
        startSeconds: 125,
        viewerCount: 2,
        profile: 'video-copy-aac',
        bufferLeadSeconds: 0,
        isPaused: false,
      }),
    ]);
    expect(service.stopJob('observable-job')).toBe(true);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(service.getJobs()).toEqual([]);
    expect(service.stopJob('observable-job')).toBe(false);

    const inputFactory = vi.fn(async () => {
      throw new Error('INPUT_REQUESTED');
    });
    await expect(
      service.ensureHls('observable-cache', inputFactory, 0, 'observable-cache', 'viewer_one'),
    ).rejects.toThrow('HLS_JOB_STOPPED');
    expect(inputFactory).not.toHaveBeenCalled();

    expect(service.releaseHls('observable-cache', 'viewer_one')).toBe(false);
    await expect(
      service.ensureHls('observable-cache', inputFactory, 0, 'observable-cache', 'viewer_one'),
    ).rejects.toThrow('INPUT_REQUESTED');
    expect(inputFactory).toHaveBeenCalledOnce();
  });

  it('prioritizes a seek request when an HLS slot becomes available', async () => {
    // Two encoders are already running, so both requests have to queue.
    let activeJobs = 2;
    const scheduler = new HlsSlotScheduler(2, () => activeJobs);

    const order: string[] = [];
    const normal = scheduler
      .reserve({
        cacheKey: 'normal-cache',
        familyKey: 'normal-family',
        sessionId: 'normal_session',
        priority: NORMAL_PRIORITY,
        mediaName: 'Normal Film',
        startSeconds: 0,
      })
      .then((reservationId) => {
        order.push('normal');
        scheduler.release(reservationId);
      });

    let seekReservation = '';
    const seek = scheduler
      .reserve({
        cacheKey: 'seek-cache',
        familyKey: 'seek-family',
        sessionId: 'seek_session',
        priority: SEEK_PRIORITY,
        mediaName: 'Seek Film',
        startSeconds: 300,
      })
      .then((reservationId) => {
        order.push('seek');
        seekReservation = reservationId;
      });

    // Someone already watching outranks a fresh start, regardless of arrival.
    expect(scheduler.snapshot()[0]).toMatchObject({
      mediaName: 'Seek Film',
      startSeconds: 300,
      priority: 'seek',
    });

    activeJobs = 1;
    scheduler.drain();
    await seek;
    expect(order).toEqual(['seek']);

    activeJobs = 0;
    scheduler.drain();
    await normal;
    expect(order).toEqual(['seek', 'normal']);

    scheduler.release(seekReservation);
    scheduler.shutdown();
  });

  it('does not cancel a queued seek when Safari releases the previous HLS window', async () => {
    let activeJobs = 2;
    const scheduler = new HlsSlotScheduler(2, () => activeJobs);

    let reservation = '';
    const queuedSeek = scheduler
      .reserve({
        cacheKey: 'law-order-at-900',
        familyKey: 'law-order',
        sessionId: 'safari_session',
        priority: SEEK_PRIORITY,
        mediaName: 'Law & Order',
        startSeconds: 900,
      })
      .then((reservationId) => {
        reservation = reservationId;
      });

    expect(scheduler.snapshot()).toHaveLength(1);

    // Releasing the window the viewer seeked *away from* must not drop the
    // request they are now waiting on — the cache keys differ.
    scheduler.cancelForSession('safari_session', 'law-order-at-0');
    expect(scheduler.snapshot()).toHaveLength(1);

    activeJobs = 1;
    scheduler.drain();
    await queuedSeek;
    expect(reservation).not.toBe('');

    scheduler.release(reservation);
    scheduler.shutdown();
  });

  it('supersedes an earlier queued request from the same session', async () => {
    const scheduler = new HlsSlotScheduler(1, () => 1);

    const superseded = scheduler.reserve({
      cacheKey: 'episode-at-0',
      familyKey: 'episode',
      sessionId: 'scrubbing_session',
      priority: SEEK_PRIORITY,
      mediaName: 'Episode',
      startSeconds: 0,
    });
    const rejection = expect(superseded).rejects.toThrow('HLS_REQUEST_SUPERSEDED');

    // A second request from the same session means the viewer scrubbed again.
    const survivor = scheduler.reserve({
      cacheKey: 'episode-at-600',
      familyKey: 'episode',
      sessionId: 'scrubbing_session',
      priority: SEEK_PRIORITY,
      mediaName: 'Episode',
      startSeconds: 600,
    });
    // Still queued at the end of the test, so its rejection has to be claimed
    // here — an unclaimed one surfaces as an unhandled rejection later.
    const shutdownRejection = expect(survivor).rejects.toThrow('HLS_SERVICE_SHUTDOWN');

    await rejection;
    expect(scheduler.snapshot()).toHaveLength(1);
    expect(scheduler.snapshot()[0]).toMatchObject({ startSeconds: 600 });

    scheduler.shutdown();
    await shutdownRejection;
  });

  it('copies H.264 video and only fully encodes incompatible video codecs', () => {
    expect(videoOptions('h264')).toEqual(['-c:v copy']);
    expect(videoOptions('hevc')).toEqual(
      expect.arrayContaining(['-c:v libx264', '-preset ultrafast']),
    );
    // An accurate seek cannot copy: it would start at the preceding keyframe.
    expect(videoOptions('h264', true)).toEqual(
      expect.arrayContaining(['-c:v libx264', '-preset ultrafast']),
    );
    expect(videoOptions('')).toContain('-c:v libx264');

    expect(selectProfile('h264', false)).toBe('video-copy-aac');
    expect(selectProfile('h264', true)).toBe('h264-aac');
    expect(selectProfile('hevc', false)).toBe('h264-aac');
  });

  it('calculates buffer lead from real EXTINF durations instead of assuming four seconds', () => {
    const service = createService(1024);
    const playlistPath = path.join(service.getCacheDir('duration-check'), 'index.m3u8');
    fs.mkdirSync(path.dirname(playlistPath), { recursive: true });
    fs.writeFileSync(
      playlistPath,
      '#EXTM3U\n#EXTINF:9.84,\nsegment-000000.m4s\n#EXTINF:10.12,\nsegment-000001.m4s\n',
    );
    const cache = new HlsCacheStore(service.getCacheDir('x').replace(/\/[^/]+$/, ''), 1024);

    expect(cache.bufferLeadSeconds(playlistPath, -1)).toBeCloseTo(19.96);
    expect(cache.bufferLeadSeconds(playlistPath, 0)).toBeCloseTo(10.12);
  });

  it('deduplicates concurrent starts for the same HLS cache', async () => {
    const service = createService(1024);
    let rejectInput!: (error: Error) => void;
    const inputFactory = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectInput = reject;
        }),
    );

    const first = service.ensureHls('shared-cache', inputFactory, 0, 'shared-family', 'viewer_one');
    await vi.waitFor(() => expect(inputFactory).toHaveBeenCalledOnce());
    const second = service.ensureHls(
      'shared-cache',
      inputFactory,
      0,
      'shared-family',
      'viewer_two',
    );

    rejectInput(new Error('SOURCE_FAILED'));
    await expect(first).rejects.toThrow('SOURCE_FAILED');
    await expect(second).rejects.toThrow('SOURCE_FAILED');
    expect(inputFactory).toHaveBeenCalledOnce();
  });
});

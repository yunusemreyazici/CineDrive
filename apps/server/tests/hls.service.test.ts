import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HlsService } from '../src/services/hls.service';

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
    const service = createService(1024);
    const idleTimerOne = setInterval(() => {}, 60_000);
    const idleTimerTwo = setInterval(() => {}, 60_000);
    idleTimerOne.unref();
    idleTimerTwo.unref();
    const internals = service as unknown as {
      jobs: Map<string, unknown>;
      reserveSlot: (familyKey: string, sessionId: string, priority: number) => Promise<string>;
      drainPendingSlots: () => void;
      releaseReservation: (reservationId: string) => void;
    };
    const fakeJob = (id: string, idleTimer: NodeJS.Timeout) => ({
      id,
      command: { kill: vi.fn() },
      ready: Promise.resolve(),
      familyKey: id,
      mediaName: id,
      pid: null,
      startSeconds: 0,
      startedAt: Date.now(),
      lastAccessAt: Date.now(),
      idleTimer,
    });
    internals.jobs.set('active-one', fakeJob('active-one', idleTimerOne));
    internals.jobs.set('active-two', fakeJob('active-two', idleTimerTwo));

    const order: string[] = [];
    let seekReservation = '';
    const normal = internals
      .reserveSlot('normal-family', 'normal_session', 1)
      .then((reservationId) => {
        order.push('normal');
        internals.releaseReservation(reservationId);
      });
    const seek = internals.reserveSlot('seek-family', 'seek_session', 2).then((reservationId) => {
      order.push('seek');
      seekReservation = reservationId;
    });

    internals.jobs.delete('active-one');
    internals.drainPendingSlots();
    await seek;
    expect(order).toEqual(['seek']);

    internals.jobs.delete('active-two');
    internals.drainPendingSlots();
    await normal;
    expect(order).toEqual(['seek', 'normal']);
    internals.releaseReservation(seekReservation);
    service.shutdown();
  });

  it('copies H.264 video and only fully encodes incompatible video codecs', () => {
    const service = createService(1024);
    const internals = service as unknown as {
      videoOptions: (videoCodec: string) => string[];
    };

    expect(internals.videoOptions('h264')).toEqual(['-c:v copy']);
    expect(internals.videoOptions('hevc')).toEqual(
      expect.arrayContaining(['-c:v libx264', '-preset ultrafast']),
    );
    expect(internals.videoOptions('')).toContain('-c:v libx264');
  });
});

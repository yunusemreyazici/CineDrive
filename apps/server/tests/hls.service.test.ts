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
    expect(() => service.resolveAsset('safe', '../secret')).toThrow(
      'INVALID_HLS_ASSET',
    );
  });

  it('stops an active encoder when its final player session is released', () => {
    const service = createService(1024);
    const kill = vi.fn();
    const idleTimer = setInterval(() => {}, 60_000);
    idleTimer.unref();
    const cacheKey = 'episode-session';

    (service as unknown as {
      jobs: Map<string, unknown>;
      leases: Map<string, Set<string>>;
    }).jobs.set(cacheKey, {
      command: { kill },
      ready: Promise.resolve(),
      familyKey: cacheKey,
      lastAccessAt: Date.now(),
      idleTimer,
    });
    (service as unknown as {
      leases: Map<string, Set<string>>;
    }).leases.set(cacheKey, new Set(['player_session_1', 'player_session_2']));

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
      command: replacementCommand,
      ready: Promise.resolve(),
      familyKey: cacheKey,
      lastAccessAt: Date.now(),
      idleTimer: replacementTimer,
    });
    internals.leases.set(cacheKey, new Set(['replacement_session']));

    expect(internals.detachJob(cacheKey, oldCommand)).toBe('replaced');
    expect(service.getStats().activeJobs).toBe(1);
    expect(internals.leases.get(cacheKey)).toEqual(
      new Set(['replacement_session']),
    );

    service.shutdown();
  });
});

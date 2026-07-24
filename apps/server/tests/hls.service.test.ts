import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('rejects unsafe cache and asset names', () => {
    const service = createService(1024);

    expect(() => service.getCacheDir('../escape')).toThrow('INVALID_HLS_KEY');
    expect(() => service.resolveAsset('safe', '../secret')).toThrow(
      'INVALID_HLS_ASSET',
    );
  });
});

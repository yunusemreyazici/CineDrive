import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MusicArtworkThumbnailService } from '../src/services/music-artwork-thumbnail.service';

describe('MusicArtworkThumbnailService', () => {
  it('caches each requested artwork size as a separate variant', async () => {
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-cache-test-'));
    let renders = 0;
    const service = new MusicArtworkThumbnailService(
      1,
      async (source) => {
        renders += 1;
        return source;
      },
      cacheDirectory,
    );

    const source = Buffer.from('image');
    await service.thumbnail('artwork', source, { width: 256, height: 256, quality: 82 });
    await service.thumbnail('artwork', source, { width: 256, height: 256, quality: 82 });
    await service.thumbnail('artwork', source, { width: 512, height: 512, quality: 82 });

    expect(renders).toBe(2);
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  });

  it('limits image rendering work across different artwork IDs', async () => {
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-cache-test-'));
    let active = 0;
    let peak = 0;
    const service = new MusicArtworkThumbnailService(
      2,
      async (source) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return source;
      },
      cacheDirectory,
    );

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        service.thumbnail(`artwork-${index}`, Buffer.from(`image-${index}`)),
      ),
    );

    expect(peak).toBe(2);
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  });

  it('reuses checksum variants from persistent disk cache after restart', async () => {
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-cache-test-'));
    let renders = 0;
    const renderer = async (source: Buffer) => {
      renders += 1;
      return source;
    };
    const source = Buffer.from('persistent-image');

    await new MusicArtworkThumbnailService(1, renderer, cacheDirectory).thumbnail(
      'abc123',
      source,
      'row',
    );
    await new MusicArtworkThumbnailService(1, renderer, cacheDirectory).thumbnail(
      'abc123',
      source,
      'row',
    );

    expect(renders).toBe(1);
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  });
});

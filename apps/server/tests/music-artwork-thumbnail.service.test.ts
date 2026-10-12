import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MusicArtworkThumbnailService } from '../src/services/music-artwork-thumbnail.service';

describe('MusicArtworkThumbnailService', () => {
  it.each(['png', 'jpeg', 'webp', 'svg'] as const)(
    'renders real %s artwork with the production image pipeline',
    async (format) => {
      const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-render-test-'));
      try {
        const source =
          format === 'svg'
            ? Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#336699"/></svg>',
              )
            : await sharp({
                create: { width: 400, height: 300, channels: 3, background: '#336699' },
              })
                .toFormat(format)
                .toBuffer();
        const service = new MusicArtworkThumbnailService(1, undefined, cacheDirectory);
        const rendered = await service.thumbnail(`fixture-${format}`, source, 'row');
        expect(rendered).not.toBeNull();
        const metadata = await sharp(rendered!).metadata();
        expect(metadata).toMatchObject({ format: 'jpeg', width: 192, height: 144 });
        const restarted = new MusicArtworkThumbnailService(1, undefined, cacheDirectory);
        expect(await restarted.thumbnail(`fixture-${format}`, Buffer.from('invalid'), 'row')).toEqual(
          rendered,
        );
      } finally {
        await fs.rm(cacheDirectory, { recursive: true, force: true });
      }
    },
  );

  it('returns no thumbnail for invalid image bytes', async () => {
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-render-test-'));
    try {
      const service = new MusicArtworkThumbnailService(1, undefined, cacheDirectory);
      expect(await service.thumbnail('invalid', Buffer.from('not an image'), 'row')).toBeNull();
      expect(await fs.readdir(cacheDirectory)).toEqual([]);
    } finally {
      await fs.rm(cacheDirectory, { recursive: true, force: true });
    }
  });

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

  it('keeps attacker-controlled artwork IDs inside the cache root', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-path-test-'));
    const cacheDirectory = path.join(temporaryRoot, 'cache');
    const service = new MusicArtworkThumbnailService(1, async (source) => source, cacheDirectory);

    await service.thumbnail('../../outside/../../escape', Buffer.from('image'), 'row');

    const files = await fs.readdir(cacheDirectory, { recursive: true });
    expect(files.some((entry) => String(entry).includes('..'))).toBe(false);
    await expect(fs.access(path.join(temporaryRoot, 'escape-row.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('rejects artwork variants outside the runtime allowlist', async () => {
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-cache-test-'));
    const service = new MusicArtworkThumbnailService(1, async (source) => source, cacheDirectory);

    await expect(
      service.thumbnail('artwork', Buffer.from('image'), '../escape' as 'row'),
    ).rejects.toThrow('Unsupported music artwork variant');
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  });
});

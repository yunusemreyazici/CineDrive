import { describe, expect, it } from 'vitest';
import { MusicArtworkThumbnailService } from '../src/services/music-artwork-thumbnail.service';

describe('MusicArtworkThumbnailService', () => {
  it('caches each requested artwork size as a separate variant', async () => {
    let renders = 0;
    const service = new MusicArtworkThumbnailService(1, async (source) => {
      renders += 1;
      return source;
    });

    const source = Buffer.from('image');
    await service.thumbnail('artwork', source, { width: 256, height: 256, quality: 82 });
    await service.thumbnail('artwork', source, { width: 256, height: 256, quality: 82 });
    await service.thumbnail('artwork', source, { width: 512, height: 512, quality: 82 });

    expect(renders).toBe(2);
  });

  it('limits FFmpeg work across different artwork IDs', async () => {
    let active = 0;
    let peak = 0;
    const service = new MusicArtworkThumbnailService(2, async (source) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return source;
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        service.thumbnail(`artwork-${index}`, Buffer.from(`image-${index}`)),
      ),
    );

    expect(peak).toBe(2);
  });
});

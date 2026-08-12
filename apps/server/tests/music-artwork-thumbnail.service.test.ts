import { describe, expect, it } from 'vitest';
import { MusicArtworkThumbnailService } from '../src/services/music-artwork-thumbnail.service';

describe('MusicArtworkThumbnailService', () => {
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

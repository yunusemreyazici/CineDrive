import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { MusicArtworkThumbnailService } from '../src/services/music-artwork-thumbnail.service';

it('compares eager versus lazy source loading on synthetic cold, warm and disk hits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-artwork-memory-experiment-'));
  try {
    // Synthetic artwork only: no production DB, provider, credentials or catalogue.
    const original = await sharp(randomBytes(960 * 720 * 3), {
      raw: { width: 960, height: 720, channels: 3 },
    })
      .png()
      .toBuffer();
    const rows: Array<{
      mode: string;
      phase: string;
      loads: number;
      sourceMiB: number;
      elapsedMs: number;
      p50Ms?: number;
    }> = [];
    for (const mode of ['eager', 'lazy'] as const) {
      const cacheDirectory = path.join(directory, mode);
      let service = new MusicArtworkThumbnailService(2, undefined, cacheDirectory);
      let loads = 0;
      const load = async () => {
        loads += 1;
        return Buffer.from(original);
      };
      const request = async () =>
        service.thumbnail('fixture', mode === 'eager' ? await load() : load, 'row');
      const record = (phase: string, start: number, p50Ms?: number) =>
        rows.push({
          mode,
          phase,
          loads,
          sourceMiB: Number(((loads * original.length) / 1024 / 1024).toFixed(2)),
          elapsedMs: Number((performance.now() - start).toFixed(2)),
          p50Ms,
        });
      let start = performance.now();
      const cold = await Promise.all(Array.from({ length: 20 }, request));
      record('cold-20-concurrent', start);
      expect(cold.every((image) => image?.equals(cold[0]!))).toBe(true);
      expect((await sharp(cold[0]!).metadata()).width).toBe(192);
      expect(loads).toBe(mode === 'eager' ? 20 : 1);
      loads = 0;
      start = performance.now();
      const times: number[] = [];
      const warm: Array<Buffer | null> = [];
      for (let index = 0; index < 100; index += 1) {
        const requestStart = performance.now();
        warm.push(await request());
        times.push(performance.now() - requestStart);
      }
      record('warm-100', start, Number(times.sort((a, b) => a - b)[50]!.toFixed(3)));
      expect(loads).toBe(mode === 'eager' ? 100 : 0);
      expect(warm.every((image) => image?.equals(cold[0]!))).toBe(true);
      service = new MusicArtworkThumbnailService(2, undefined, cacheDirectory);
      loads = 0;
      start = performance.now();
      const disk = await request();
      record('disk-after-restart', start);
      expect(disk).toEqual(cold[0]);
      expect(loads).toBe(mode === 'eager' ? 1 : 0);
    }
    // Counts/bytes are regression assertions. Timings are diagnostic only, not
    // flaky gates or claims about production end-to-end/network latency/RSS.
    console.info('Synthetic artwork experiment:', JSON.stringify(rows));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

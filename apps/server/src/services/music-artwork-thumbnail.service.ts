import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const MAX_CACHE_ENTRIES = 256;
const THUMBNAIL_EDGE = 256;
const MAX_CONCURRENT_RENDERS = 2;

export class MusicArtworkThumbnailService {
  private readonly cache = new Map<string, Buffer>();
  private readonly inFlight = new Map<string, Promise<Buffer | null>>();
  private activeRenders = 0;
  private readonly renderWaiters: Array<() => void> = [];

  public constructor(
    private readonly maxConcurrentRenders = MAX_CONCURRENT_RENDERS,
    private readonly renderer?: (source: Buffer) => Promise<Buffer | null>,
  ) {}

  public async thumbnail(
    id: string,
    source: Buffer,
    options: { width?: number; height?: number; quality?: number } = {},
  ): Promise<Buffer | null> {
    const width = Math.max(32, Math.min(2048, Math.round(options.width || THUMBNAIL_EDGE)));
    const height = Math.max(32, Math.min(2048, Math.round(options.height || width)));
    const quality = Math.max(20, Math.min(100, Math.round(options.quality || 82)));
    const cacheKey = `${id}:${width}x${height}:q${quality}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const pending = this.withRenderSlot(
      () => this.renderer?.(source) ?? this.render(source, width, height, quality),
    )
      .then((result) => {
        if (!result) return null;
        this.cache.set(cacheKey, result);
        while (this.cache.size > MAX_CACHE_ENTRIES) {
          const oldest = this.cache.keys().next().value as string | undefined;
          if (!oldest) break;
          this.cache.delete(oldest);
        }
        return result;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, pending);
    return pending;
  }

  private render(
    source: Buffer,
    width: number,
    height: number,
    quality: number,
  ): Promise<Buffer | null> {
    if (!ffmpegPath) return Promise.resolve(null);
    const binary = ffmpegPath as string;
    return new Promise((resolve) => {
      const child = spawn(binary, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vf',
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-q:v',
        String(Math.max(2, Math.round(31 - (quality / 100) * 29))),
        'pipe:1',
      ]);
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr?.resume();
      child.stdin?.on('error', () => undefined);
      child.once('error', () => resolve(null));
      child.once('close', (code: number | null) =>
        resolve(code === 0 ? Buffer.concat(chunks) : null),
      );
      child.stdin?.end(source);
    });
  }

  private async withRenderSlot<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireRenderSlot();
    try {
      return await operation();
    } finally {
      this.releaseRenderSlot();
    }
  }

  private acquireRenderSlot(): Promise<void> {
    if (this.activeRenders < this.maxConcurrentRenders) {
      this.activeRenders += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.renderWaiters.push(() => {
        this.activeRenders += 1;
        resolve();
      });
    });
  }

  private releaseRenderSlot(): void {
    this.activeRenders = Math.max(0, this.activeRenders - 1);
    this.renderWaiters.shift()?.();
  }
}

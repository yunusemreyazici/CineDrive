import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_MEMORY_CACHE_ENTRIES = 512;
const MAX_CONCURRENT_RENDERS = 2;

export const musicArtworkVariantSpecs = {
  row: { width: 192, height: 192, quality: 78 },
  small: { width: 256, height: 256, quality: 80 },
  card: { width: 384, height: 384, quality: 82 },
  hero: { width: 768, height: 768, quality: 84 },
} as const;

export type MusicArtworkVariant = keyof typeof musicArtworkVariantSpecs;
type VariantSpec = (typeof musicArtworkVariantSpecs)[MusicArtworkVariant];
type LegacyOptions = { width?: number; height?: number; quality?: number };
type ArtworkRenderer = (source: Buffer, spec: VariantSpec) => Promise<Buffer | null>;

const defaultCacheDirectory = path.resolve(process.cwd(), 'data', 'music_artwork_cache');

export const isMusicArtworkVariant = (value: string): value is MusicArtworkVariant =>
  Object.prototype.hasOwnProperty.call(musicArtworkVariantSpecs, value);

export const nearestMusicArtworkVariant = (options: LegacyOptions): MusicArtworkVariant => {
  const requestedEdge = Math.max(Number(options.width || 0), Number(options.height || 0));
  if (requestedEdge <= musicArtworkVariantSpecs.row.width) return 'row';
  if (requestedEdge <= musicArtworkVariantSpecs.small.width) return 'small';
  if (requestedEdge <= musicArtworkVariantSpecs.card.width) return 'card';
  return 'hero';
};

export class MusicArtworkThumbnailService {
  private readonly cache = new Map<string, Buffer>();
  private readonly inFlight = new Map<string, Promise<Buffer | null>>();
  private readonly cacheDirectory: string;
  private activeRenders = 0;
  private readonly renderWaiters: Array<() => void> = [];

  public constructor(
    private readonly maxConcurrentRenders = MAX_CONCURRENT_RENDERS,
    private readonly renderer?: ArtworkRenderer,
    cacheDirectory = defaultCacheDirectory,
  ) {
    this.cacheDirectory = path.resolve(cacheDirectory);
  }

  public async thumbnail(
    checksum: string,
    source: Buffer,
    variantOrOptions: MusicArtworkVariant | LegacyOptions = 'small',
  ): Promise<Buffer | null> {
    const requestedVariant =
      typeof variantOrOptions === 'string'
        ? variantOrOptions
        : nearestMusicArtworkVariant(variantOrOptions);
    if (!isMusicArtworkVariant(requestedVariant)) {
      throw new Error('Unsupported music artwork variant.');
    }
    const variant = requestedVariant;
    const cacheKey = `${checksum}:${variant}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    const diskPath = this.variantPath(checksum, variant);
    const diskCached = await fs.readFile(diskPath).catch(() => null);
    if (diskCached) {
      this.remember(cacheKey, diskCached);
      return diskCached;
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const spec = musicArtworkVariantSpecs[variant];
    const pending = this.withRenderSlot(
      () => this.renderer?.(source, spec) ?? this.render(source, spec),
    )
      .then(async (result) => {
        if (!result) return null;
        await this.persist(diskPath, result).catch(() => undefined);
        this.remember(cacheKey, result);
        return result;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, pending);
    return pending;
  }

  public async prewarm(checksum: string, source: Buffer): Promise<void> {
    await Promise.all(
      (Object.keys(musicArtworkVariantSpecs) as MusicArtworkVariant[]).map((variant) =>
        this.thumbnail(checksum, source, variant),
      ),
    );
  }

  private async render(source: Buffer, spec: VariantSpec): Promise<Buffer | null> {
    try {
      return await sharp(source, { failOn: 'none', sequentialRead: true })
        .rotate()
        .resize(spec.width, spec.height, {
          fit: 'inside',
          withoutEnlargement: true,
          fastShrinkOnLoad: true,
        })
        .jpeg({ quality: spec.quality, mozjpeg: true })
        .toBuffer();
    } catch {
      return null;
    }
  }

  private variantPath(checksum: string, variant: MusicArtworkVariant) {
    // Always hash external identifiers instead of conditionally trusting a
    // checksum-shaped value. Only fixed variant names reach the filesystem.
    const safeChecksum = createHash('sha256').update(checksum).digest('hex');
    const directory = path.join(this.cacheDirectory, safeChecksum.slice(0, 2));
    const candidate = path.join(directory, `${safeChecksum}-${variant}.jpg`);
    const relative = path.relative(this.cacheDirectory, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Artwork cache path escaped its configured root.');
    }
    return candidate;
  }

  private async persist(destination: string, data: Buffer) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, data);
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private remember(key: string, value: Buffer) {
    this.cache.set(key, value);
    while (this.cache.size > MAX_MEMORY_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
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

  private releaseRenderSlot() {
    this.activeRenders = Math.max(0, this.activeRenders - 1);
    this.renderWaiters.shift()?.();
  }
}

export const musicArtworkThumbnails = new MusicArtworkThumbnailService();

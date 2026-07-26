import fs from 'node:fs';
import path from 'node:path';

/**
 * Owns the HLS cache directory: where a stream's files live, how recently each
 * was read, and which ones get evicted.
 *
 * It deliberately knows nothing about jobs or leases. Callers pass the cache
 * keys that must survive eviction, which keeps the "what is in use" decision
 * with the service that tracks running encoders.
 */

const CACHE_VERSION = 'safari-h264-v7';
const ACCESS_MARKER = '.access';
const COMPLETE_MARKER = '.complete';
/** How many cached variants (base plus seek points) of one title to retain. */
const MAX_FAMILY_CACHE_ENTRIES = 3;
/**
 * A fully generated cache has no running job to protect it, but it may still be
 * the directory a viewer is streaming segments from right now.
 */
const RECENT_ACCESS_PROTECTION_MS = 5 * 60 * 1000;
/** A playlist counts as playable once this many segments exist. */
const READY_SEGMENT_COUNT = 1;

export interface CacheEntry {
  directory: string;
  accessedAt: number;
  size: number;
}

export class HlsCacheStore {
  private readonly recentlyServed = new Map<string, number>();

  constructor(
    public readonly cacheRoot: string,
    private readonly maxCacheBytes: number,
  ) {
    fs.mkdirSync(this.cacheRoot, { recursive: true });
  }

  /** Rejects anything that could escape the cache root. */
  public getCacheDir(cacheKey: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(cacheKey)) throw new Error('INVALID_HLS_KEY');
    return path.join(this.cacheRoot, `${cacheKey}-${CACHE_VERSION}`);
  }

  public markRecentlyServed(cacheKey: string) {
    this.recentlyServed.set(cacheKey, Date.now());
  }

  public clearRecentlyServed() {
    this.recentlyServed.clear();
  }

  public isReady(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const playlist = fs.readFileSync(playlistPath, 'utf8');
    return (playlist.match(/#EXTINF:/g) || []).length >= READY_SEGMENT_COUNT;
  }

  public isComplete(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const completionMarker = path.join(path.dirname(playlistPath), COMPLETE_MARKER);
    return (
      fs.existsSync(completionMarker) &&
      fs.readFileSync(playlistPath, 'utf8').includes('#EXT-X-ENDLIST')
    );
  }

  public markComplete(outputDir: string) {
    fs.writeFileSync(path.join(outputDir, COMPLETE_MARKER), '');
  }

  public touch(directory: string) {
    if (!fs.existsSync(directory)) return;
    const marker = path.join(directory, ACCESS_MARKER);
    const now = new Date();
    try {
      if (!fs.existsSync(marker)) fs.writeFileSync(marker, '');
      fs.utimesSync(marker, now, now);
    } catch {
      // Cache access tracking must never interrupt playback.
    }
  }

  public remove(directory: string) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // A missing directory is the desired end state anyway.
    }
  }

  public exists(directory: string) {
    return fs.existsSync(directory);
  }

  public create(directory: string) {
    fs.mkdirSync(directory, { recursive: true });
  }

  /**
   * How many seconds of playlist sit ahead of the segment the viewer last
   * asked for — the signal used to pause a runaway encoder.
   */
  public bufferLeadSeconds(playlistPath: string, lastRequestedSegment: number) {
    try {
      const playlist = fs.readFileSync(playlistPath, 'utf8');
      const durations = [...playlist.matchAll(/^#EXTINF:([\d.]+)/gm)].map((match) =>
        Number(match[1]),
      );
      const firstUnrequestedSegment = Math.max(0, lastRequestedSegment + 1);
      return Math.max(
        0,
        durations
          .slice(firstUnrequestedSegment)
          .reduce((total, duration) => total + (Number.isFinite(duration) ? duration : 0), 0),
      );
    } catch {
      return 0;
    }
  }

  public entries(): CacheEntry[] {
    if (!fs.existsSync(this.cacheRoot)) return [];
    return fs
      .readdirSync(this.cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(this.cacheRoot, entry.name);
        const marker = path.join(directory, ACCESS_MARKER);
        const accessedAt = fs.existsSync(marker)
          ? fs.statSync(marker).mtimeMs
          : fs.statSync(directory).mtimeMs;
        return { directory, accessedAt, size: this.directorySize(directory) };
      });
  }

  public totalBytes() {
    return this.entries().reduce((total, entry) => total + entry.size, 0);
  }

  public get quotaBytes() {
    return this.maxCacheBytes;
  }

  /** Evicts least-recently-used directories until the cache is under quota. */
  public enforceQuota(inUseCacheKeys: Iterable<string>, protectedCacheKey?: string) {
    const protectedDirectory = protectedCacheKey ? this.getCacheDir(protectedCacheKey) : undefined;
    const protectedDirectories = this.protectedDirectories(inUseCacheKeys);
    const entries = this.entries();
    let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);

    for (const entry of entries.sort((left, right) => left.accessedAt - right.accessedAt)) {
      if (totalBytes <= this.maxCacheBytes) break;
      if (entry.directory === protectedDirectory || protectedDirectories.has(entry.directory)) {
        continue;
      }
      this.remove(entry.directory);
      totalBytes -= entry.size;
    }
  }

  /**
   * Caps how many cached variants one title keeps. Seeking mints a new cache
   * key per timestamp, so without this a scrubbed episode fills the disk.
   */
  public enforceFamilyLimit(
    familyKey: string,
    inUseCacheKeys: Iterable<string>,
    protectedCacheKey?: string,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(familyKey)) throw new Error('INVALID_HLS_KEY');

    const protectedDirectory = protectedCacheKey ? this.getCacheDir(protectedCacheKey) : undefined;
    const protectedDirectories = this.protectedDirectories(inUseCacheKeys);
    const baseDirectoryName = `${familyKey}-${CACHE_VERSION}`;
    const seekDirectoryPrefix = `${familyKey}-at-`;
    const versionSuffix = `-${CACHE_VERSION}`;

    const familyEntries = this.entries()
      .filter((entry) => {
        const name = path.basename(entry.directory);
        return (
          name === baseDirectoryName ||
          (name.startsWith(seekDirectoryPrefix) && name.endsWith(versionSuffix))
        );
      })
      .sort((left, right) => right.accessedAt - left.accessedAt);

    let retainedEntries = 0;
    for (const entry of familyEntries) {
      const mustRetain =
        entry.directory === protectedDirectory || protectedDirectories.has(entry.directory);
      if (mustRetain || retainedEntries < MAX_FAMILY_CACHE_ENTRIES) {
        retainedEntries += 1;
        continue;
      }
      this.remove(entry.directory);
    }
  }

  /**
   * Directories that must survive eviction: those the caller reports as in use
   * (a running encoder or a held lease), plus those served recently.
   */
  private protectedDirectories(inUseCacheKeys: Iterable<string>) {
    const now = Date.now();
    const keys = new Set<string>(inUseCacheKeys);

    for (const [cacheKey, servedAt] of this.recentlyServed) {
      if (now - servedAt >= RECENT_ACCESS_PROTECTION_MS) {
        this.recentlyServed.delete(cacheKey);
        continue;
      }
      keys.add(cacheKey);
    }

    const directories = new Set<string>();
    for (const key of keys) {
      try {
        directories.add(this.getCacheDir(key));
      } catch {
        // An invalid key cannot correspond to a cache directory.
      }
    }
    return directories;
  }

  private directorySize(directory: string): number {
    let size = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) size += this.directorySize(entryPath);
      else if (entry.isFile()) size += fs.statSync(entryPath).size;
    }
    return size;
  }
}

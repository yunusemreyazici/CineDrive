import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const READY_SEGMENT_COUNT = 3;
const WAIT_TIMEOUT_MS = 45_000;
const IDLE_JOB_TIMEOUT_MS = 45_000;
const CACHE_VERSION = 'safari-h264-v6';
const DEFAULT_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_JOBS = 2;
const MAX_FAMILY_CACHE_ENTRIES = 3;
const ACCESS_MARKER = '.access';
const COMPLETE_MARKER = '.complete';

export type HlsServiceOptions = {
  cacheRoot?: string;
  maxCacheBytes?: number;
  maxActiveJobs?: number;
};

export type HlsCacheStats = {
  activeJobs: number;
  cacheBytes: number;
  cacheEntries: number;
  maxCacheBytes: number;
  maxActiveJobs: number;
};

type HlsJob = {
  command: FfmpegCommand;
  ready: Promise<void>;
  familyKey: string;
  lastAccessAt: number;
  idleTimer: NodeJS.Timeout;
};

export class HlsService {
  private readonly cacheRoot: string;
  private readonly maxCacheBytes: number;
  private readonly maxActiveJobs: number;
  private readonly jobs = new Map<string, HlsJob>();
  private readonly leases = new Map<string, Set<string>>();

  constructor(options: HlsServiceOptions = {}) {
    this.cacheRoot =
      options.cacheRoot || path.resolve(process.cwd(), 'data/hls_cache');
    this.maxCacheBytes = this.positiveNumber(
      options.maxCacheBytes,
      process.env.HLS_CACHE_MAX_BYTES,
      DEFAULT_CACHE_BYTES,
    );
    this.maxActiveJobs = this.positiveNumber(
      options.maxActiveJobs,
      process.env.HLS_MAX_ACTIVE_JOBS,
      DEFAULT_MAX_ACTIVE_JOBS,
    );
    fs.mkdirSync(this.cacheRoot, { recursive: true });
    this.enforceCacheQuota();
  }

  public getCacheDir(cacheKey: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(cacheKey)) throw new Error('INVALID_HLS_KEY');
    return path.join(this.cacheRoot, `${cacheKey}-${CACHE_VERSION}`);
  }

  public async ensureHls(
    cacheKey: string,
    inputFactory: () => Promise<string | Readable>,
    startSeconds = 0,
    familyKey = cacheKey,
    sessionId?: string,
  ) {
    const outputDir = this.getCacheDir(cacheKey);
    const playlistPath = path.join(outputDir, 'index.m3u8');
    if (sessionId) this.acquireLease(cacheKey, sessionId);

    let job = this.jobs.get(cacheKey);
    if (job) {
      job.lastAccessAt = Date.now();
      this.touchCache(outputDir);
      await job.ready;
      return playlistPath;
    }

    if (this.isComplete(playlistPath)) {
      this.touchCache(outputDir);
      this.enforceFamilyCacheLimit(familyKey, cacheKey);
      return playlistPath;
    }

    // Seeking creates a new cache key for the requested timestamp. The old
    // encoder for the same episode must not keep occupying a transcode slot
    // for another 45 seconds, otherwise a couple of seeks can exhaust the
    // global capacity and Safari receives a 500 response.
    for (const [activeKey, activeJob] of this.jobs) {
      if (activeKey === cacheKey || activeJob.familyKey !== familyKey) continue;
      clearInterval(activeJob.idleTimer);
      this.jobs.delete(activeKey);
      this.leases.delete(activeKey);
      try {
        activeJob.command.kill('SIGKILL');
      } catch {
        // Process may already have exited.
      }
    }

    if (this.jobs.size >= this.maxActiveJobs) {
      throw new Error('HLS_CAPACITY_REACHED');
    }

    this.enforceCacheQuota(cacheKey);
    this.enforceFamilyCacheLimit(familyKey, cacheKey);

    // A previous viewer may have left while an EVENT playlist was still being
    // generated. Start clean instead of presenting a permanently truncated
    // playlist as if it were a complete episode.
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }

    if (!job) {
      const input = await inputFactory();

      // Resolving a remote source may take long enough for a concurrent
      // request to start this cache first. Discard the duplicate source.
      job = this.jobs.get(cacheKey);
      if (job) {
        if (typeof input !== 'string') input.destroy();
        await job.ready;
        return playlistPath;
      }
      if (sessionId && !this.leases.get(cacheKey)?.has(sessionId)) {
        if (typeof input !== 'string') input.destroy();
        throw new Error('HLS_CLIENT_RELEASED');
      }

      fs.mkdirSync(outputDir, { recursive: true });
      this.touchCache(outputDir);
      this.enforceFamilyCacheLimit(familyKey, cacheKey);
      const sourceCodecs =
        typeof input === 'string' ? this.probeLocalCodecs(input) : null;
      // Although recent Safari versions can decode many HEVC files directly,
      // some hvc1 sources still fail after they are remuxed as fragmented HLS.
      // Keep H.264 zero-copy, but make every other codec deterministic for the
      // Safari compatibility path.
      const canCopyVideo = sourceCodecs?.video === 'h264';
      const videoOptions = canCopyVideo
        ? ['-c:v copy']
        : [
            '-c:v libx264',
            '-preset ultrafast',
            '-tune zerolatency',
            '-b:v 5M',
            '-maxrate 6M',
            '-bufsize 12M',
            '-profile:v high',
            '-level:v 4.1',
            '-pix_fmt yuv420p',
            '-force_key_frames expr:gte(t,n_forced*4)',
          ];
      const command = ffmpeg(input)
        // Generate a modest buffer ahead of playback instead of racing through
        // a multi-GB source and duplicating the whole file immediately.
        .inputOptions([
          ...(startSeconds > 0 ? ['-ss', String(startSeconds)] : []),
          '-readrate 2',
        ])
        .outputOptions([
          '-map 0:v:0',
          '-map 0:a:0?',
          '-sn',
          '-dn',
          ...videoOptions,
          '-c:a aac',
          '-b:a 192k',
          '-ac 2',
          '-f hls',
          '-hls_time 4',
          '-hls_list_size 0',
          '-hls_playlist_type event',
          '-hls_segment_type fmp4',
          '-hls_fmp4_init_filename init.mp4',
          '-hls_segment_filename',
          path.join(outputDir, 'segment-%06d.m4s'),
          '-hls_flags independent_segments+temp_file',
        ])
        .output(playlistPath);

      const ready = new Promise<void>((resolve, reject) => {
        let settled = false;
        let poll: NodeJS.Timeout | undefined;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          if (poll) clearInterval(poll);
          callback();
        };

        command
          .on('error', (error: Error) => {
            const jobState = this.detachJob(cacheKey, command);
            // FFmpeg writes ENDLIST when it is terminated gracefully. That
            // does not mean the episode was fully generated, so never retain
            // an interrupted cache as a reusable completed stream. A newer
            // encoder may already own this key after fast back/forward
            // navigation, so the old process must not remove its output.
            if (jobState !== 'replaced') {
              fs.rmSync(outputDir, { recursive: true, force: true });
            }
            finish(() => reject(error));
          })
          .on('end', () => {
            const jobState = this.detachJob(cacheKey, command);
            if (jobState === 'replaced') {
              finish(resolve);
              return;
            }
            fs.writeFileSync(path.join(outputDir, COMPLETE_MARKER), '');
            this.touchCache(outputDir);
            this.enforceFamilyCacheLimit(familyKey, cacheKey);
            this.enforceCacheQuota(cacheKey);
            finish(resolve);
          })
          .run();

        const startedAt = Date.now();
        poll = setInterval(() => {
          if (this.isReady(playlistPath)) {
            finish(resolve);
          } else if (Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
            finish(() => reject(new Error('HLS_PREPARATION_TIMEOUT')));
          }
        }, 250);
      });

      const idleTimer = setInterval(() => {
        const activeJob = this.jobs.get(cacheKey);
        if (
          activeJob &&
          Date.now() - activeJob.lastAccessAt >= IDLE_JOB_TIMEOUT_MS
        ) {
          activeJob.command.kill('SIGKILL');
        }
      }, 5_000);
      idleTimer.unref();

      job = {
        command,
        ready,
        familyKey,
        lastAccessAt: Date.now(),
        idleTimer,
      };
      this.jobs.set(cacheKey, job);
    }

    await job.ready;
    return playlistPath;
  }

  public resolveAsset(cacheKey: string, assetName: string) {
    if (!/^(index\.m3u8|init\.mp4|segment-\d{6}\.m4s)$/.test(assetName)) {
      throw new Error('INVALID_HLS_ASSET');
    }
    const job = this.jobs.get(cacheKey);
    if (job) job.lastAccessAt = Date.now();
    const cacheDir = this.getCacheDir(cacheKey);
    this.touchCache(cacheDir);
    return path.join(cacheDir, assetName);
  }

  public getStats(): HlsCacheStats {
    const entries = this.cacheEntries();
    return {
      activeJobs: this.jobs.size,
      cacheBytes: entries.reduce((total, entry) => total + entry.size, 0),
      cacheEntries: entries.length,
      maxCacheBytes: this.maxCacheBytes,
      maxActiveJobs: this.maxActiveJobs,
    };
  }

  public releaseHls(cacheKey: string, sessionId: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
      throw new Error('INVALID_HLS_SESSION');
    }
    const sessions = this.leases.get(cacheKey);
    if (!sessions) return false;

    sessions.delete(sessionId);
    if (sessions.size > 0) return false;

    this.leases.delete(cacheKey);
    const job = this.jobs.get(cacheKey);
    if (!job) return false;

    clearInterval(job.idleTimer);
    this.jobs.delete(cacheKey);
    try {
      job.command.kill('SIGKILL');
    } catch {
      // Process may already have exited.
    }
    return true;
  }

  public enforceCacheQuota(protectedCacheKey?: string) {
    const protectedDirectory = protectedCacheKey
      ? this.getCacheDir(protectedCacheKey)
      : undefined;
    const activeDirectories = new Set(
      [...this.jobs.keys()].map((key) => this.getCacheDir(key)),
    );
    const entries = this.cacheEntries();
    let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);

    for (const entry of entries.sort((left, right) => left.accessedAt - right.accessedAt)) {
      if (totalBytes <= this.maxCacheBytes) break;
      if (entry.directory === protectedDirectory || activeDirectories.has(entry.directory)) {
        continue;
      }
      fs.rmSync(entry.directory, { recursive: true, force: true });
      totalBytes -= entry.size;
    }
  }

  public enforceFamilyCacheLimit(
    familyKey: string,
    protectedCacheKey?: string,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(familyKey)) {
      throw new Error('INVALID_HLS_KEY');
    }
    const protectedDirectory = protectedCacheKey
      ? this.getCacheDir(protectedCacheKey)
      : undefined;
    const activeDirectories = new Set(
      [...this.jobs.keys()].map((key) => this.getCacheDir(key)),
    );
    const baseDirectoryName = `${familyKey}-${CACHE_VERSION}`;
    const seekDirectoryPrefix = `${familyKey}-at-`;
    const versionSuffix = `-${CACHE_VERSION}`;
    const familyEntries = this.cacheEntries()
      .filter((entry) => {
        const name = path.basename(entry.directory);
        return (
          name === baseDirectoryName ||
          (name.startsWith(seekDirectoryPrefix) &&
            name.endsWith(versionSuffix))
        );
      })
      .sort((left, right) => right.accessedAt - left.accessedAt);

    let retainedEntries = 0;
    for (const entry of familyEntries) {
      const mustRetain =
        entry.directory === protectedDirectory ||
        activeDirectories.has(entry.directory);
      if (mustRetain || retainedEntries < MAX_FAMILY_CACHE_ENTRIES) {
        retainedEntries += 1;
        continue;
      }
      fs.rmSync(entry.directory, { recursive: true, force: true });
    }
  }

  public shutdown() {
    for (const job of this.jobs.values()) {
      clearInterval(job.idleTimer);
      try {
        job.command.kill('SIGKILL');
      } catch {
        // Process may already have exited.
      }
    }
    this.jobs.clear();
    this.leases.clear();
  }

  private acquireLease(cacheKey: string, sessionId: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
      throw new Error('INVALID_HLS_SESSION');
    }
    const sessions = this.leases.get(cacheKey) || new Set<string>();
    sessions.add(sessionId);
    this.leases.set(cacheKey, sessions);
  }

  private detachJob(cacheKey: string, command: FfmpegCommand) {
    const currentJob = this.jobs.get(cacheKey);
    if (!currentJob) return 'missing' as const;
    if (currentJob.command !== command) return 'replaced' as const;

    clearInterval(currentJob.idleTimer);
    this.jobs.delete(cacheKey);
    this.leases.delete(cacheKey);
    return 'detached' as const;
  }

  private isReady(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const playlist = fs.readFileSync(playlistPath, 'utf8');
    return (playlist.match(/#EXTINF:/g) || []).length >= READY_SEGMENT_COUNT;
  }

  private isComplete(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const completionMarker = path.join(
      path.dirname(playlistPath),
      COMPLETE_MARKER,
    );
    return (
      fs.existsSync(completionMarker) &&
      fs.readFileSync(playlistPath, 'utf8').includes('#EXT-X-ENDLIST')
    );
  }

  private touchCache(directory: string) {
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

  private cacheEntries() {
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
        return {
          directory,
          accessedAt,
          size: this.directorySize(directory),
        };
      });
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

  private positiveNumber(
    explicitValue: number | undefined,
    environmentValue: string | undefined,
    fallback: number,
  ) {
    const parsed = explicitValue ?? Number(environmentValue);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  private probeLocalCodecs(inputPath: string) {
    if (!ffmpegPath) return null;
    const result = spawnSync(
      ffmpegPath,
      ['-hide_banner', '-i', inputPath, '-t', '0', '-f', 'null', '-'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    const output = result.stderr || '';
    return {
      video: output.match(/Video:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
      audio: output.match(/Audio:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
    };
  }
}

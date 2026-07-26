import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg';
import { HlsProcessRegistry } from './hls-process-registry.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

// Returning the initial playlist only after three segments made MKV sources
// wait 10–15 seconds behind a remote Drive connection. Mobile WebKit can
// abandon the media request before that. A complete first segment plus the
// fMP4 init file is sufficient for playback while FFmpeg continues filling
// the EVENT playlist in the background.
const READY_SEGMENT_COUNT = 1;
const WAIT_TIMEOUT_MS = 45_000;
const IDLE_JOB_TIMEOUT_MS = 45_000;
const CACHE_VERSION = 'safari-h264-v7';
const DEFAULT_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_JOBS = 2;
const MAX_FAMILY_CACHE_ENTRIES = 3;
const ACCESS_MARKER = '.access';
const COMPLETE_MARKER = '.complete';
const PROCESS_REGISTRY_FILE = '.active-processes.json';
// Codec probes and process lookups are advisory: if one hangs, carry on rather
// than hold a viewer's playback behind it.
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_MAX_STDERR_BYTES = 1024 * 1024;

interface LocalCodecs {
  video: string | undefined;
  audio: string | undefined;
}
const MANUAL_STOP_BLOCK_MS = 5 * 60 * 1000;
// A queued request must not wait forever for a slot that may never free up.
const PENDING_SLOT_TIMEOUT_MS = 90_000;
// A fully generated cache has no running job to protect it, but it may still be
// the directory a viewer is streaming segments from right now.
const RECENT_ACCESS_PROTECTION_MS = 5 * 60 * 1000;

export type HlsServiceOptions = {
  cacheRoot?: string;
  maxCacheBytes?: number;
  maxActiveJobs?: number;
};

export type HlsInput =
  | string
  | Readable
  | {
      url: string;
      inputOptions?: string[];
    };

export type HlsCacheStats = {
  activeJobs: number;
  queuedJobs: number;
  cacheBytes: number;
  cacheEntries: number;
  maxCacheBytes: number;
  maxActiveJobs: number;
  jobs: HlsJobInfo[];
  queue: HlsQueueInfo[];
};

type HlsJob = {
  id: string;
  command: FfmpegCommand;
  ready: Promise<void>;
  familyKey: string;
  mediaName: string;
  pid: number | null;
  startSeconds: number;
  startedAt: number;
  lastAccessAt: number;
  idleTimer: NodeJS.Timeout;
  profile: 'video-copy-aac' | 'h264-aac';
  lastRequestedSegment: number;
  isPaused: boolean;
};

export type HlsJobInfo = {
  id: string;
  cacheKey: string;
  mediaName: string;
  pid: number | null;
  startSeconds: number;
  startedAt: string;
  lastAccessAt: string;
  viewerCount: number;
  profile: 'video-copy-aac' | 'h264-aac';
  bufferLeadSeconds: number;
  isPaused: boolean;
};

export type HlsQueueInfo = {
  id: string;
  mediaName: string;
  startSeconds: number;
  priority: 'seek' | 'normal';
  queuedAt: string;
  waitMs: number;
};

type PendingSlot = {
  id: string;
  cacheKey: string;
  familyKey: string;
  sessionId?: string;
  priority: number;
  queuedAt: number;
  mediaName: string;
  startSeconds: number;
  resolve: (reservationId: string) => void;
  reject: (error: Error) => void;
  dispose: () => void;
};

export class HlsService {
  private readonly cacheRoot: string;
  private readonly maxCacheBytes: number;
  private readonly maxActiveJobs: number;
  private readonly processRegistryPath: string;
  private readonly jobs = new Map<string, HlsJob>();
  private readonly leases = new Map<string, Set<string>>();
  private readonly blockedSessions = new Map<string, number>();
  private readonly processRegistry: HlsProcessRegistry;
  private readonly pendingSlots: PendingSlot[] = [];
  private readonly reservedSlots = new Set<string>();
  private readonly inflightStarts = new Map<string, Promise<string>>();
  private readonly recentlyServed = new Map<string, number>();

  constructor(options: HlsServiceOptions = {}) {
    this.cacheRoot = options.cacheRoot || path.resolve(process.cwd(), 'data/hls_cache');
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
    this.processRegistryPath = path.join(this.cacheRoot, PROCESS_REGISTRY_FILE);
    this.processRegistry = new HlsProcessRegistry(this.processRegistryPath, this.cacheRoot);
    // Reaping a previous run's strays must not delay the port from opening.
    void this.processRegistry.reapOrphans();
    this.enforceCacheQuota();
  }

  public getCacheDir(cacheKey: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(cacheKey)) throw new Error('INVALID_HLS_KEY');
    return path.join(this.cacheRoot, `${cacheKey}-${CACHE_VERSION}`);
  }

  public async ensureHls(
    cacheKey: string,
    inputFactory: () => Promise<HlsInput>,
    startSeconds = 0,
    familyKey = cacheKey,
    sessionId?: string,
    mediaName = cacheKey,
    sourceVideoCodec?: string | null,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new Error('HLS_CLIENT_ABORTED');

    const inflight = this.inflightStarts.get(cacheKey);
    if (inflight) {
      if (sessionId) {
        if (this.isSessionBlocked(cacheKey, sessionId)) {
          throw new Error('HLS_JOB_STOPPED');
        }
        this.acquireLease(cacheKey, sessionId);
      }
      return inflight;
    }

    const start = this.startHls(
      cacheKey,
      inputFactory,
      startSeconds,
      familyKey,
      sessionId,
      mediaName,
      sourceVideoCodec,
      signal,
    );
    this.inflightStarts.set(cacheKey, start);
    try {
      return await start;
    } finally {
      if (this.inflightStarts.get(cacheKey) === start) {
        this.inflightStarts.delete(cacheKey);
      }
    }
  }

  private async startHls(
    cacheKey: string,
    inputFactory: () => Promise<HlsInput>,
    startSeconds: number,
    familyKey: string,
    sessionId: string | undefined,
    mediaName: string,
    sourceVideoCodec: string | null | undefined,
    signal?: AbortSignal,
  ) {
    if (sessionId && this.isSessionBlocked(cacheKey, sessionId)) {
      throw new Error('HLS_JOB_STOPPED');
    }

    const outputDir = this.getCacheDir(cacheKey);
    const playlistPath = path.join(outputDir, 'index.m3u8');
    if (sessionId) this.acquireLease(cacheKey, sessionId);
    this.markRecentlyServed(cacheKey);

    let job = this.jobs.get(cacheKey);
    if (job) {
      const pendingCommand = job.command;
      job.lastAccessAt = Date.now();
      this.touchCache(outputDir);
      try {
        await job.ready;
      } catch (error) {
        // A job that failed to become ready must not stay in the map: it would
        // keep re-throwing the same stale error to every later request while
        // its own idle timer is refreshed, holding a slot forever.
        this.abandonJob(cacheKey, pendingCommand, outputDir);
        throw error;
      }
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

    this.drainPendingSlots();
    const reservationId = await this.reserveSlot(
      cacheKey,
      familyKey,
      sessionId,
      startSeconds > 0 ? 2 : 1,
      mediaName,
      startSeconds,
      signal,
    );

    try {
      if (signal?.aborted) throw new Error('HLS_CLIENT_ABORTED');
      if (sessionId && this.isSessionBlocked(cacheKey, sessionId)) {
        throw new Error('HLS_JOB_STOPPED');
      }
      if (sessionId && !this.leases.get(cacheKey)?.has(sessionId)) {
        throw new Error('HLS_CLIENT_RELEASED');
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
          if (typeof input !== 'string' && !('url' in input)) input.destroy();
          await job.ready;
          return playlistPath;
        }
        if (sessionId && !this.leases.get(cacheKey)?.has(sessionId)) {
          if (typeof input !== 'string' && !('url' in input)) input.destroy();
          throw new Error('HLS_CLIENT_RELEASED');
        }
        // Resolving a remote source involves network I/O; the viewer may have
        // navigated away in the meantime. Never spawn FFmpeg for nobody.
        if (signal?.aborted) {
          if (typeof input !== 'string' && !('url' in input)) input.destroy();
          throw new Error('HLS_CLIENT_ABORTED');
        }

        fs.mkdirSync(outputDir, { recursive: true });
        this.touchCache(outputDir);
        this.enforceFamilyCacheLimit(familyKey, cacheKey);
        const isRemoteUrlInput = typeof input === 'object' && 'url' in input;
        const inputSource = isRemoteUrlInput ? input.url : input;
        const probedCodecs =
          typeof inputSource === 'string' && !isRemoteUrlInput
            ? await this.probeLocalCodecs(inputSource)
            : null;
        const normalizedVideoCodec = sourceVideoCodec?.toLowerCase() || probedCodecs?.video || '';
        // Although recent Safari versions can decode many HEVC files directly,
        // some hvc1 sources still fail after they are remuxed as fragmented HLS.
        // Keep H.264 zero-copy, but make every other codec deterministic for the
        // Safari compatibility path.
        const accurateSeekRequired = startSeconds > 0;
        const videoOptions = this.videoOptions(normalizedVideoCodec, accurateSeekRequired);
        const profile =
          normalizedVideoCodec === 'h264' && !accurateSeekRequired ? 'video-copy-aac' : 'h264-aac';
        const command = ffmpeg(inputSource)
          // Generate a modest buffer ahead of playback instead of racing through
          // a multi-GB source and duplicating the whole file immediately.
          .inputOptions([
            ...(isRemoteUrlInput ? input.inputOptions || [] : []),
            ...(startSeconds > 0 ? ['-ss', String(startSeconds)] : []),
            '-readrate',
            // MKV sources often have 8–10 second keyframe intervals, so the
            // first complete copy-remuxed HLS segment otherwise arrives too
            // late for mobile WebKit. Burst at 4x for startup; the lead-based
            // pause below still caps background generation at 24 seconds.
            '4',
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
        const jobId = crypto.randomUUID();
        const startedAt = Date.now();
        let processId: number | null = null;

        // FFmpeg explains input failures on stderr. Without keeping the tail,
        // a failed job surfaces only as a generic error and the actual cause
        // (bad URL, auth rejection, unsupported codec) is lost.
        const stderrTail: string[] = [];
        const describeFailure = (reason: string) =>
          stderrTail.length > 0 ? `${reason} | ffmpeg: ${stderrTail.join(' ⏎ ')}` : reason;

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
            .on('stderr', (line: string) => {
              const trimmed = String(line).trim();
              if (!trimmed) return;
              stderrTail.push(trimmed);
              if (stderrTail.length > 12) stderrTail.shift();
            })
            .on('start', () => {
              processId =
                (
                  command as FfmpegCommand & {
                    ffmpegProc?: { pid?: number };
                  }
                ).ffmpegProc?.pid || null;
              const activeJob = this.jobs.get(cacheKey);
              if (activeJob?.id === jobId) activeJob.pid = processId;
              if (processId) {
                this.processRegistry.register({
                  jobId,
                  pid: processId,
                  cacheKey,
                  startedAt,
                });
              }
            })
            .on('error', (error: Error) => {
              this.processRegistry.unregister(jobId);
              const jobState = this.detachJob(cacheKey, command);
              // FFmpeg writes ENDLIST when it is terminated gracefully. That
              // does not mean the episode was fully generated, so never retain
              // an interrupted cache as a reusable completed stream. A newer
              // encoder may already own this key after fast back/forward
              // navigation, so the old process must not remove its output.
              if (jobState !== 'replaced') {
                fs.rmSync(outputDir, { recursive: true, force: true });
              }
              finish(() => reject(new Error(describeFailure(error.message))));
            })
            .on('end', () => {
              this.processRegistry.unregister(jobId);
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

          poll = setInterval(() => {
            if (this.isReady(playlistPath)) {
              finish(resolve);
            } else if (Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
              // Tear the job down rather than only rejecting the waiter: an
              // orphaned entry in `jobs` would occupy a global slot forever and
              // re-throw this same error to every subsequent request.
              finish(() => {
                this.processRegistry.unregister(jobId);
                this.abandonJob(cacheKey, command, outputDir);
                reject(new Error(describeFailure('HLS_PREPARATION_TIMEOUT')));
              });
            }
          }, 250);
        });

        const idleTimer = setInterval(() => {
          const activeJob = this.jobs.get(cacheKey);
          if (activeJob && Date.now() - activeJob.lastAccessAt >= IDLE_JOB_TIMEOUT_MS) {
            activeJob.command.kill('SIGKILL');
            return;
          }
          if (activeJob?.pid) {
            const leadSeconds = this.bufferLeadSeconds(
              path.join(outputDir, 'index.m3u8'),
              activeJob.lastRequestedSegment,
            );
            if (leadSeconds >= 24 && !activeJob.isPaused) {
              this.setJobPaused(activeJob, true);
            } else if (leadSeconds <= 12 && activeJob.isPaused) {
              this.setJobPaused(activeJob, false);
            }
          }
        }, 1_000);
        idleTimer.unref();

        job = {
          id: jobId,
          command,
          ready,
          familyKey,
          mediaName,
          pid: processId,
          startSeconds,
          startedAt,
          lastAccessAt: Date.now(),
          idleTimer,
          profile,
          lastRequestedSegment: -1,
          isPaused: false,
        };
        this.jobs.set(cacheKey, job);
        this.consumeReservation(reservationId);
      }

      await job.ready;
      return playlistPath;
    } finally {
      this.releaseReservation(reservationId);
    }
  }

  public resolveAsset(cacheKey: string, assetName: string) {
    if (!/^(index\.m3u8|init\.mp4|segment-\d{6}\.m4s)$/.test(assetName)) {
      throw new Error('INVALID_HLS_ASSET');
    }
    const job = this.jobs.get(cacheKey);
    if (job) {
      job.lastAccessAt = Date.now();
      const segment = assetName.match(/^segment-(\d{6})\.m4s$/);
      if (segment) {
        job.lastRequestedSegment = Math.max(job.lastRequestedSegment, Number(segment[1]));
        if (job.isPaused) this.setJobPaused(job, false);
      }
    }
    const cacheDir = this.getCacheDir(cacheKey);
    this.markRecentlyServed(cacheKey);
    this.touchCache(cacheDir);
    return path.join(cacheDir, assetName);
  }

  public getStats(): HlsCacheStats {
    const entries = this.cacheEntries();
    return {
      activeJobs: this.jobs.size,
      queuedJobs: this.pendingSlots.length,
      cacheBytes: entries.reduce((total, entry) => total + entry.size, 0),
      cacheEntries: entries.length,
      maxCacheBytes: this.maxCacheBytes,
      maxActiveJobs: this.maxActiveJobs,
      jobs: this.getJobs(),
      queue: this.getQueue(),
    };
  }

  public getJobs(): HlsJobInfo[] {
    return [...this.jobs.entries()]
      .map(([cacheKey, job]) => ({
        id: job.id,
        cacheKey,
        mediaName: job.mediaName,
        pid: job.pid,
        startSeconds: job.startSeconds,
        startedAt: new Date(job.startedAt).toISOString(),
        lastAccessAt: new Date(job.lastAccessAt).toISOString(),
        viewerCount: this.leases.get(cacheKey)?.size || 0,
        profile: job.profile,
        bufferLeadSeconds: this.bufferLeadSeconds(
          path.join(this.getCacheDir(cacheKey), 'index.m3u8'),
          job.lastRequestedSegment,
        ),
        isPaused: job.isPaused,
      }))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  public getQueue(): HlsQueueInfo[] {
    const now = Date.now();
    return this.pendingSlots.map((pending) => ({
      id: pending.id,
      mediaName: pending.mediaName,
      startSeconds: pending.startSeconds,
      priority: pending.priority > 1 ? 'seek' : 'normal',
      queuedAt: new Date(pending.queuedAt).toISOString(),
      waitMs: now - pending.queuedAt,
    }));
  }

  public stopJob(jobId: string) {
    const entry = [...this.jobs.entries()].find(([, job]) => job.id === jobId);
    if (!entry) return false;
    const [cacheKey, job] = entry;
    const blockedUntil = Date.now() + MANUAL_STOP_BLOCK_MS;
    for (const sessionId of this.leases.get(cacheKey) ?? []) {
      this.blockedSessions.set(this.sessionKey(cacheKey, sessionId), blockedUntil);
    }
    clearInterval(job.idleTimer);
    this.jobs.delete(cacheKey);
    this.leases.delete(cacheKey);
    try {
      job.command.kill('SIGKILL');
    } catch {
      // Process may already have exited.
    }
    this.drainPendingSlots();
    return true;
  }

  public releaseHls(cacheKey: string, sessionId: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
      throw new Error('INVALID_HLS_SESSION');
    }
    this.blockedSessions.delete(this.sessionKey(cacheKey, sessionId));
    this.cancelPendingSlots(sessionId, cacheKey);
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
    this.drainPendingSlots();
    return true;
  }

  public enforceCacheQuota(protectedCacheKey?: string) {
    const protectedDirectory = protectedCacheKey ? this.getCacheDir(protectedCacheKey) : undefined;
    const activeDirectories = this.protectedDirectories();
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

  public enforceFamilyCacheLimit(familyKey: string, protectedCacheKey?: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(familyKey)) {
      throw new Error('INVALID_HLS_KEY');
    }
    const protectedDirectory = protectedCacheKey ? this.getCacheDir(protectedCacheKey) : undefined;
    const activeDirectories = this.protectedDirectories();
    const baseDirectoryName = `${familyKey}-${CACHE_VERSION}`;
    const seekDirectoryPrefix = `${familyKey}-at-`;
    const versionSuffix = `-${CACHE_VERSION}`;
    const familyEntries = this.cacheEntries()
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
        entry.directory === protectedDirectory || activeDirectories.has(entry.directory);
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
    this.blockedSessions.clear();
    this.recentlyServed.clear();
    for (const pending of this.pendingSlots.splice(0)) {
      pending.dispose();
      pending.reject(new Error('HLS_SERVICE_SHUTDOWN'));
    }
    this.reservedSlots.clear();
    this.inflightStarts.clear();
  }

  /**
   * Directories that must survive eviction: those with a running encoder, those
   * a player session still holds a lease on, and those served recently. The
   * last case covers a fully generated cache, which has no job to protect it
   * yet may be exactly what a viewer is streaming segments from right now.
   */
  private protectedDirectories() {
    const now = Date.now();
    const keys = new Set<string>([...this.jobs.keys(), ...this.leases.keys()]);

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

  private markRecentlyServed(cacheKey: string) {
    this.recentlyServed.set(cacheKey, Date.now());
  }

  /**
   * Removes a job that will never become usable, kills its encoder and drops
   * the partial output so the next request starts from a clean slate.
   */
  private abandonJob(cacheKey: string, command: FfmpegCommand, outputDir: string) {
    const jobState = this.detachJob(cacheKey, command);
    try {
      command.kill('SIGKILL');
    } catch {
      // Process may already have exited.
    }
    if (jobState !== 'replaced') {
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
      } catch {
        // A missing directory is the desired end state anyway.
      }
    }
  }

  private acquireLease(cacheKey: string, sessionId: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
      throw new Error('INVALID_HLS_SESSION');
    }
    const sessions = this.leases.get(cacheKey) || new Set<string>();
    sessions.add(sessionId);
    this.leases.set(cacheKey, sessions);
  }

  private sessionKey(cacheKey: string, sessionId: string) {
    return `${cacheKey}:${sessionId}`;
  }

  private videoOptions(videoCodec: string, accurateSeekRequired = false) {
    if (videoCodec === 'h264' && !accurateSeekRequired) return ['-c:v copy'];
    return [
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
  }

  private bufferLeadSeconds(playlistPath: string, lastRequestedSegment: number) {
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

  private setJobPaused(job: HlsJob, paused: boolean) {
    if (!job.pid || job.isPaused === paused) return;
    try {
      process.kill(job.pid, paused ? 'SIGSTOP' : 'SIGCONT');
      job.isPaused = paused;
    } catch {
      // The encoder may have exited between the health check and signal.
    }
  }

  private isSessionBlocked(cacheKey: string, sessionId: string) {
    const key = this.sessionKey(cacheKey, sessionId);
    const blockedUntil = this.blockedSessions.get(key);
    if (!blockedUntil) return false;
    if (blockedUntil <= Date.now()) {
      this.blockedSessions.delete(key);
      return false;
    }
    return true;
  }

  private reserveSlot(
    cacheKey: string,
    familyKey: string,
    sessionId: string | undefined,
    priority: number,
    mediaName: string,
    startSeconds: number,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.jobs.size + this.reservedSlots.size < this.maxActiveJobs) {
      const reservationId = crypto.randomUUID();
      this.reservedSlots.add(reservationId);
      return Promise.resolve(reservationId);
    }

    if (sessionId) this.cancelPendingSlots(sessionId);
    return new Promise<string>((resolve, reject) => {
      const id = crypto.randomUUID();

      // A queued request previously had no exit other than a slot opening up,
      // so a client that disconnected still eventually started a full job.
      const timeout = setTimeout(() => {
        this.removePendingSlot(id, new Error('HLS_QUEUE_TIMEOUT'));
      }, PENDING_SLOT_TIMEOUT_MS);
      timeout.unref();

      const onAbort = () => this.removePendingSlot(id, new Error('HLS_CLIENT_ABORTED'));
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pendingSlots.push({
        id,
        cacheKey,
        familyKey,
        sessionId,
        priority,
        queuedAt: Date.now(),
        mediaName,
        startSeconds,
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onAbort);
        },
      });
      this.sortPendingSlots();
    });
  }

  private removePendingSlot(id: string, error: Error) {
    const index = this.pendingSlots.findIndex((pending) => pending.id === id);
    if (index < 0) return;
    const [pending] = this.pendingSlots.splice(index, 1);
    pending!.dispose();
    pending!.reject(error);
  }

  private cancelPendingSlots(sessionId: string, cacheKey?: string) {
    for (let index = this.pendingSlots.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingSlots[index]!;
      if (
        pending.sessionId !== sessionId ||
        (cacheKey !== undefined && pending.cacheKey !== cacheKey)
      ) {
        continue;
      }
      this.pendingSlots.splice(index, 1);
      pending.dispose();
      pending.reject(new Error('HLS_REQUEST_SUPERSEDED'));
    }
  }

  private sortPendingSlots() {
    this.pendingSlots.sort(
      (left, right) => right.priority - left.priority || left.queuedAt - right.queuedAt,
    );
  }

  private drainPendingSlots() {
    this.sortPendingSlots();
    while (
      this.pendingSlots.length > 0 &&
      this.jobs.size + this.reservedSlots.size < this.maxActiveJobs
    ) {
      const pending = this.pendingSlots.shift()!;
      const reservationId = pending.id;
      this.reservedSlots.add(reservationId);
      pending.dispose();
      pending.resolve(reservationId);
    }
  }

  private consumeReservation(reservationId: string) {
    this.reservedSlots.delete(reservationId);
  }

  private releaseReservation(reservationId: string) {
    if (!this.reservedSlots.delete(reservationId)) return;
    this.drainPendingSlots();
  }

  private detachJob(cacheKey: string, command: FfmpegCommand) {
    const currentJob = this.jobs.get(cacheKey);
    if (!currentJob) return 'missing' as const;
    if (currentJob.command !== command) return 'replaced' as const;

    clearInterval(currentJob.idleTimer);
    this.jobs.delete(cacheKey);
    this.leases.delete(cacheKey);
    this.drainPendingSlots();
    return 'detached' as const;
  }

  /** Reads a process's command line without blocking the event loop. */
  private isReady(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const playlist = fs.readFileSync(playlistPath, 'utf8');
    return (playlist.match(/#EXTINF:/g) || []).length >= READY_SEGMENT_COUNT;
  }

  private isComplete(playlistPath: string) {
    if (!fs.existsSync(playlistPath)) return false;
    const completionMarker = path.join(path.dirname(playlistPath), COMPLETE_MARKER);
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

  /**
   * Reads the codecs FFmpeg reports for a local file.
   *
   * This used to be `spawnSync`. Node is single-threaded, so probing blocked
   * the event loop — and with it every other viewer's segment request — for as
   * long as FFmpeg took to open the file.
   */
  private probeLocalCodecs(inputPath: string): Promise<LocalCodecs | null> {
    if (!ffmpegPath) return Promise.resolve(null);

    return new Promise((resolve) => {
      const child = spawn(
        ffmpegPath!,
        ['-hide_banner', '-i', inputPath, '-t', '0', '-f', 'null', '-'],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );

      let stderr = '';
      let settled = false;
      const finish = (output: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          video: output.match(/Video:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
          audio: output.match(/Audio:\s*([^,\s]+)/)?.[1]?.toLowerCase(),
        });
      };

      // A probe that hangs must not hold up playback; an unknown codec simply
      // routes through the deterministic H.264 path.
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(stderr);
      }, PROBE_TIMEOUT_MS);

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < PROBE_MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
      });
      child.on('error', () => finish(''));
      child.on('close', () => finish(stderr));
    });
  }
}

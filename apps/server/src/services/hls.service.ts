import path from 'node:path';
import crypto from 'node:crypto';
import { type FfmpegCommand } from 'fluent-ffmpeg';
import { HlsProcessRegistry } from './hls-process-registry.js';
import { HlsCacheStore } from './hls-cache-store.js';
import { HlsSlotScheduler, NORMAL_PRIORITY, SEEK_PRIORITY } from './hls-slot-scheduler.js';
import { buildHlsCommand, resolveVideoCodec, selectProfile } from './hls-encoder.js';
import type {
  HlsCacheStats,
  HlsInput,
  HlsJobInfo,
  HlsProfile,
  HlsServiceOptions,
} from './hls-types.js';

export type {
  HlsCacheStats,
  HlsInput,
  HlsJobInfo,
  HlsQueueInfo,
  HlsServiceOptions,
} from './hls-types.js';

/** How long a job may take to produce its first playable segment. */
const WAIT_TIMEOUT_MS = 45_000;
/** A job nobody has requested a segment from for this long is torn down. */
const IDLE_JOB_TIMEOUT_MS = 45_000;
const DEFAULT_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_JOBS = 2;
const PROCESS_REGISTRY_FILE = '.active-processes.json';
/** A manually stopped job stays stopped, or the player just restarts it. */
const MANUAL_STOP_BLOCK_MS = 5 * 60 * 1000;
/** Encoding pauses above this lead and resumes below the lower bound. */
const PAUSE_LEAD_SECONDS = 24;
const RESUME_LEAD_SECONDS = 12;
const JOB_HEALTH_INTERVAL_MS = 1_000;
const READY_POLL_INTERVAL_MS = 250;
/** Keep the tail of FFmpeg's stderr so a failure explains itself. */
const STDERR_TAIL_LINES = 12;

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
  profile: HlsProfile;
  lastRequestedSegment: number;
  isPaused: boolean;
};

/**
 * Owns the lifecycle of HLS transcode jobs: which encoders are running, which
 * player sessions hold them open, and when they are torn down.
 *
 * Three concerns that used to live here have their own collaborators — the disk
 * cache (`HlsCacheStore`), slot admission (`HlsSlotScheduler`) and FFmpeg
 * invocation (`hls-encoder`) — leaving this class to coordinate them.
 */
export class HlsService {
  private readonly cache: HlsCacheStore;
  private readonly scheduler: HlsSlotScheduler;
  private readonly processRegistry: HlsProcessRegistry;

  private readonly jobs = new Map<string, HlsJob>();
  /** Player sessions currently holding a cache key open. */
  private readonly leases = new Map<string, Set<string>>();
  private readonly blockedSessions = new Map<string, number>();
  /** De-duplicates concurrent starts of the same cache key. */
  private readonly inflightStarts = new Map<string, Promise<string>>();

  constructor(options: HlsServiceOptions = {}) {
    const cacheRoot = options.cacheRoot || path.resolve(process.cwd(), 'data/hls_cache');
    this.cache = new HlsCacheStore(
      cacheRoot,
      positiveNumber(options.maxCacheBytes, process.env.HLS_CACHE_MAX_BYTES, DEFAULT_CACHE_BYTES),
    );
    this.scheduler = new HlsSlotScheduler(
      positiveNumber(options.maxActiveJobs, process.env.HLS_MAX_ACTIVE_JOBS, DEFAULT_MAX_ACTIVE_JOBS),
      () => this.jobs.size,
    );
    this.processRegistry = new HlsProcessRegistry(
      path.join(cacheRoot, PROCESS_REGISTRY_FILE),
      cacheRoot,
    );

    // Reaping a previous run's strays must not delay the port from opening.
    void this.processRegistry.reapOrphans();
    this.enforceCacheQuota();
  }

  public getCacheDir(cacheKey: string) {
    return this.cache.getCacheDir(cacheKey);
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
        if (this.isSessionBlocked(cacheKey, sessionId)) throw new Error('HLS_JOB_STOPPED');
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

    const outputDir = this.cache.getCacheDir(cacheKey);
    const playlistPath = path.join(outputDir, 'index.m3u8');
    if (sessionId) this.acquireLease(cacheKey, sessionId);
    this.cache.markRecentlyServed(cacheKey);

    const existingJob = this.jobs.get(cacheKey);
    if (existingJob) {
      const pendingCommand = existingJob.command;
      existingJob.lastAccessAt = Date.now();
      this.cache.touch(outputDir);
      try {
        await existingJob.ready;
      } catch (error) {
        // A job that failed to become ready must not stay in the map: it would
        // keep re-throwing the same stale error to every later request while
        // its own idle timer is refreshed, holding a slot forever.
        this.abandonJob(cacheKey, pendingCommand, outputDir);
        throw error;
      }
      return playlistPath;
    }

    if (this.cache.isComplete(playlistPath)) {
      this.cache.touch(outputDir);
      this.enforceFamilyCacheLimit(familyKey, cacheKey);
      return playlistPath;
    }

    this.evictSupersededFamilyJobs(cacheKey, familyKey);

    this.scheduler.drain();
    const reservationId = await this.scheduler.reserve({
      cacheKey,
      familyKey,
      sessionId,
      priority: startSeconds > 0 ? SEEK_PRIORITY : NORMAL_PRIORITY,
      mediaName,
      startSeconds,
      signal,
    });

    try {
      this.assertStillWanted(cacheKey, sessionId, signal);

      this.enforceCacheQuota(cacheKey);
      this.enforceFamilyCacheLimit(familyKey, cacheKey);

      // A previous viewer may have left while an EVENT playlist was still being
      // generated. Start clean instead of presenting a permanently truncated
      // playlist as if it were a complete episode.
      if (this.cache.exists(outputDir)) this.cache.remove(outputDir);

      const input = await inputFactory();

      // Resolving a remote source may take long enough for a concurrent
      // request to start this cache first. Discard the duplicate source.
      const raced = this.jobs.get(cacheKey);
      if (raced) {
        destroyStreamInput(input);
        await raced.ready;
        return playlistPath;
      }

      try {
        this.assertStillWanted(cacheKey, sessionId, signal);
      } catch (error) {
        destroyStreamInput(input);
        throw error;
      }

      this.cache.create(outputDir);
      this.cache.touch(outputDir);
      this.enforceFamilyCacheLimit(familyKey, cacheKey);

      const job = this.spawnJob({
        cacheKey,
        input,
        outputDir,
        playlistPath,
        startSeconds,
        familyKey,
        mediaName,
        videoCodec: await resolveVideoCodec(input, sourceVideoCodec),
      });
      this.jobs.set(cacheKey, job);
      this.scheduler.consume(reservationId);

      await job.ready;
      return playlistPath;
    } finally {
      this.scheduler.release(reservationId);
    }
  }

  /**
   * Seeking creates a new cache key for the requested timestamp. The old
   * encoder for the same episode must not keep occupying a transcode slot for
   * another 45 seconds, or a couple of seeks exhaust the global capacity and
   * Safari receives a 500.
   */
  private evictSupersededFamilyJobs(cacheKey: string, familyKey: string) {
    for (const [activeKey, activeJob] of this.jobs) {
      if (activeKey === cacheKey || activeJob.familyKey !== familyKey) continue;
      clearInterval(activeJob.idleTimer);
      this.jobs.delete(activeKey);
      this.leases.delete(activeKey);
      killCommand(activeJob.command);
    }
  }

  /** Throws if the viewer went away or the job was stopped while we waited. */
  private assertStillWanted(cacheKey: string, sessionId: string | undefined, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('HLS_CLIENT_ABORTED');
    if (!sessionId) return;
    if (this.isSessionBlocked(cacheKey, sessionId)) throw new Error('HLS_JOB_STOPPED');
    if (!this.leases.get(cacheKey)?.has(sessionId)) throw new Error('HLS_CLIENT_RELEASED');
  }

  private spawnJob(options: {
    cacheKey: string;
    input: HlsInput;
    outputDir: string;
    playlistPath: string;
    startSeconds: number;
    familyKey: string;
    mediaName: string;
    videoCodec: string;
  }): HlsJob {
    const { cacheKey, outputDir, playlistPath, startSeconds, familyKey, mediaName, videoCodec } =
      options;

    const command = buildHlsCommand({
      input: options.input,
      outputDir,
      playlistPath,
      startSeconds,
      videoCodec,
    });
    const jobId = crypto.randomUUID();
    const startedAt = Date.now();
    let processId: number | null = null;

    // FFmpeg explains input failures on stderr. Without keeping the tail, a
    // failed job surfaces only as a generic error and the actual cause (bad
    // URL, auth rejection, unsupported codec) is lost.
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
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        })
        .on('start', () => {
          processId =
            (command as FfmpegCommand & { ffmpegProc?: { pid?: number } }).ffmpegProc?.pid || null;
          const activeJob = this.jobs.get(cacheKey);
          if (activeJob?.id === jobId) activeJob.pid = processId;
          if (processId) {
            this.processRegistry.register({ jobId, pid: processId, cacheKey, startedAt });
          }
        })
        .on('error', (error: Error) => {
          this.processRegistry.unregister(jobId);
          const jobState = this.detachJob(cacheKey, command);
          // FFmpeg writes ENDLIST when it is terminated gracefully. That does
          // not mean the episode was fully generated, so never retain an
          // interrupted cache as a reusable completed stream. A newer encoder
          // may already own this key after fast back/forward navigation, so the
          // old process must not remove its output.
          if (jobState !== 'replaced') this.cache.remove(outputDir);
          finish(() => reject(new Error(describeFailure(error.message))));
        })
        .on('end', () => {
          this.processRegistry.unregister(jobId);
          const jobState = this.detachJob(cacheKey, command);
          if (jobState === 'replaced') {
            finish(resolve);
            return;
          }
          this.cache.markComplete(outputDir);
          this.cache.touch(outputDir);
          this.enforceFamilyCacheLimit(familyKey, cacheKey);
          this.enforceCacheQuota(cacheKey);
          finish(resolve);
        })
        .run();

      poll = setInterval(() => {
        if (this.cache.isReady(playlistPath)) {
          finish(resolve);
        } else if (Date.now() - startedAt >= WAIT_TIMEOUT_MS) {
          // Tear the job down rather than only rejecting the waiter: an orphaned
          // entry in `jobs` would occupy a global slot forever and re-throw this
          // same error to every subsequent request.
          finish(() => {
            this.processRegistry.unregister(jobId);
            this.abandonJob(cacheKey, command, outputDir);
            reject(new Error(describeFailure('HLS_PREPARATION_TIMEOUT')));
          });
        }
      }, READY_POLL_INTERVAL_MS);
    });

    const idleTimer = setInterval(() => this.checkJobHealth(cacheKey), JOB_HEALTH_INTERVAL_MS);
    idleTimer.unref();

    return {
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
      profile: selectProfile(videoCodec, startSeconds > 0),
      lastRequestedSegment: -1,
      isPaused: false,
    };
  }

  /**
   * Kills an abandoned encoder, and throttles one that has raced too far ahead
   * of the viewer by suspending its process rather than discarding its output.
   */
  private checkJobHealth(cacheKey: string) {
    const job = this.jobs.get(cacheKey);
    if (!job) return;

    if (Date.now() - job.lastAccessAt >= IDLE_JOB_TIMEOUT_MS) {
      killCommand(job.command);
      return;
    }
    if (!job.pid) return;

    const leadSeconds = this.cache.bufferLeadSeconds(
      path.join(this.cache.getCacheDir(cacheKey), 'index.m3u8'),
      job.lastRequestedSegment,
    );
    if (leadSeconds >= PAUSE_LEAD_SECONDS && !job.isPaused) this.setJobPaused(job, true);
    else if (leadSeconds <= RESUME_LEAD_SECONDS && job.isPaused) this.setJobPaused(job, false);
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

    const cacheDir = this.cache.getCacheDir(cacheKey);
    this.cache.markRecentlyServed(cacheKey);
    this.cache.touch(cacheDir);
    return path.join(cacheDir, assetName);
  }

  public getStats(): HlsCacheStats {
    const entries = this.cache.entries();
    return {
      activeJobs: this.jobs.size,
      queuedJobs: this.scheduler.queueLength,
      cacheBytes: entries.reduce((total, entry) => total + entry.size, 0),
      cacheEntries: entries.length,
      maxCacheBytes: this.cache.quotaBytes,
      maxActiveJobs: this.scheduler.maxActiveJobs,
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
        bufferLeadSeconds: this.cache.bufferLeadSeconds(
          path.join(this.cache.getCacheDir(cacheKey), 'index.m3u8'),
          job.lastRequestedSegment,
        ),
        isPaused: job.isPaused,
      }))
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  public getQueue() {
    return this.scheduler.snapshot();
  }

  public stopJob(jobId: string) {
    const entry = [...this.jobs.entries()].find(([, job]) => job.id === jobId);
    if (!entry) return false;

    const [cacheKey, job] = entry;
    // Block the sessions that were watching, or the player immediately asks
    // for the same stream again and the stop appears to do nothing.
    const blockedUntil = Date.now() + MANUAL_STOP_BLOCK_MS;
    for (const sessionId of this.leases.get(cacheKey) ?? []) {
      this.blockedSessions.set(sessionKey(cacheKey, sessionId), blockedUntil);
    }

    this.teardownJob(cacheKey, job);
    return true;
  }

  public releaseHls(cacheKey: string, sessionId: string) {
    assertValidSessionId(sessionId);
    this.blockedSessions.delete(sessionKey(cacheKey, sessionId));
    this.scheduler.cancelForSession(sessionId, cacheKey);

    const sessions = this.leases.get(cacheKey);
    if (!sessions) return false;

    sessions.delete(sessionId);
    if (sessions.size > 0) return false;
    this.leases.delete(cacheKey);

    const job = this.jobs.get(cacheKey);
    if (!job) return false;

    this.teardownJob(cacheKey, job, { leaseAlreadyCleared: true });
    return true;
  }

  public enforceCacheQuota(protectedCacheKey?: string) {
    this.cache.enforceQuota(this.inUseCacheKeys(), protectedCacheKey);
  }

  public enforceFamilyCacheLimit(familyKey: string, protectedCacheKey?: string) {
    this.cache.enforceFamilyLimit(familyKey, this.inUseCacheKeys(), protectedCacheKey);
  }

  public shutdown() {
    for (const job of this.jobs.values()) {
      clearInterval(job.idleTimer);
      killCommand(job.command);
    }
    this.jobs.clear();
    this.leases.clear();
    this.blockedSessions.clear();
    this.cache.clearRecentlyServed();
    this.scheduler.shutdown();
    this.inflightStarts.clear();
  }

  /** Cache keys with a running encoder or a live player lease. */
  private inUseCacheKeys() {
    return new Set<string>([...this.jobs.keys(), ...this.leases.keys()]);
  }

  private teardownJob(cacheKey: string, job: HlsJob, options?: { leaseAlreadyCleared?: boolean }) {
    clearInterval(job.idleTimer);
    this.jobs.delete(cacheKey);
    if (!options?.leaseAlreadyCleared) this.leases.delete(cacheKey);
    killCommand(job.command);
    this.scheduler.drain();
  }

  /**
   * Removes a job that will never become usable, kills its encoder and drops
   * the partial output so the next request starts from a clean slate.
   */
  private abandonJob(cacheKey: string, command: FfmpegCommand, outputDir: string) {
    const jobState = this.detachJob(cacheKey, command);
    killCommand(command);
    if (jobState !== 'replaced') this.cache.remove(outputDir);
  }

  /**
   * Detaches a job only if `command` is still the one registered for the key —
   * a newer encoder may already have taken it over.
   */
  private detachJob(cacheKey: string, command: FfmpegCommand) {
    const currentJob = this.jobs.get(cacheKey);
    if (!currentJob) return 'missing' as const;
    if (currentJob.command !== command) return 'replaced' as const;

    clearInterval(currentJob.idleTimer);
    this.jobs.delete(cacheKey);
    this.leases.delete(cacheKey);
    this.scheduler.drain();
    return 'detached' as const;
  }

  private acquireLease(cacheKey: string, sessionId: string) {
    assertValidSessionId(sessionId);
    const sessions = this.leases.get(cacheKey) || new Set<string>();
    sessions.add(sessionId);
    this.leases.set(cacheKey, sessions);
  }

  private setJobPaused(job: HlsJob, paused: boolean) {
    if (!job.pid || job.isPaused === paused) return;
    try {
      process.kill(job.pid, paused ? 'SIGSTOP' : 'SIGCONT');
      job.isPaused = paused;
    } catch {
      // The encoder may have exited between the health check and the signal.
    }
  }

  private isSessionBlocked(cacheKey: string, sessionId: string) {
    const key = sessionKey(cacheKey, sessionId);
    const blockedUntil = this.blockedSessions.get(key);
    if (!blockedUntil) return false;
    if (blockedUntil <= Date.now()) {
      this.blockedSessions.delete(key);
      return false;
    }
    return true;
  }
}

const sessionKey = (cacheKey: string, sessionId: string) => `${cacheKey}:${sessionId}`;

const assertValidSessionId = (sessionId: string) => {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) throw new Error('INVALID_HLS_SESSION');
};

const killCommand = (command: FfmpegCommand) => {
  try {
    command.kill('SIGKILL');
  } catch {
    // Process may already have exited.
  }
};

/** Only stream inputs hold resources that need releasing when discarded. */
const destroyStreamInput = (input: HlsInput) => {
  if (typeof input !== 'string' && !('url' in input)) input.destroy();
};

const positiveNumber = (
  explicitValue: number | undefined,
  environmentValue: string | undefined,
  fallback: number,
) => {
  const parsed = explicitValue ?? Number(environmentValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

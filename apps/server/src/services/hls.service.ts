import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const READY_SEGMENT_COUNT = 3;
const WAIT_TIMEOUT_MS = 45_000;
const IDLE_JOB_TIMEOUT_MS = 45_000;
const CACHE_VERSION = 'safari-h264-v7';
const DEFAULT_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_JOBS = 2;
const MAX_FAMILY_CACHE_ENTRIES = 3;
const ACCESS_MARKER = '.access';
const COMPLETE_MARKER = '.complete';
const PROCESS_REGISTRY_FILE = '.active-processes.json';
const MANUAL_STOP_BLOCK_MS = 5 * 60 * 1000;

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

type ProcessRegistryEntry = {
  jobId: string;
  pid: number;
  cacheKey: string;
  startedAt: number;
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
};

export class HlsService {
  private readonly cacheRoot: string;
  private readonly maxCacheBytes: number;
  private readonly maxActiveJobs: number;
  private readonly processRegistryPath: string;
  private readonly jobs = new Map<string, HlsJob>();
  private readonly leases = new Map<string, Set<string>>();
  private readonly blockedSessions = new Map<string, number>();
  private readonly processRegistry = new Map<string, ProcessRegistryEntry>();
  private readonly pendingSlots: PendingSlot[] = [];
  private readonly reservedSlots = new Set<string>();
  private readonly inflightStarts = new Map<string, Promise<string>>();

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
    this.cleanupOrphanedProcesses();
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
  ) {
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
  ) {
    if (sessionId && this.isSessionBlocked(cacheKey, sessionId)) {
      throw new Error('HLS_JOB_STOPPED');
    }

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

    this.drainPendingSlots();
    const reservationId = await this.reserveSlot(
      cacheKey,
      familyKey,
      sessionId,
      startSeconds > 0 ? 2 : 1,
      mediaName,
      startSeconds,
    );

    try {
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

        fs.mkdirSync(outputDir, { recursive: true });
        this.touchCache(outputDir);
        this.enforceFamilyCacheLimit(familyKey, cacheKey);
        const isRemoteUrlInput = typeof input === 'object' && 'url' in input;
        const inputSource = isRemoteUrlInput ? input.url : input;
        const probedCodecs =
          typeof inputSource === 'string' && !isRemoteUrlInput
            ? this.probeLocalCodecs(inputSource)
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
            '2',
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
                this.processRegistry.set(jobId, {
                  jobId,
                  pid: processId,
                  cacheKey,
                  startedAt,
                });
                this.persistProcessRegistry();
              }
            })
            .on('error', (error: Error) => {
              this.unregisterProcess(jobId);
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
              this.unregisterProcess(jobId);
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
          if (activeJob && Date.now() - activeJob.lastAccessAt >= IDLE_JOB_TIMEOUT_MS) {
            activeJob.command.kill('SIGKILL');
            return;
          }
          if (activeJob?.pid) {
            const producedSegments = this.countSegments(outputDir);
            const requestedSegments = Math.max(0, activeJob.lastRequestedSegment + 1);
            const leadSeconds = (producedSegments - requestedSegments) * 4;
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
        bufferLeadSeconds: Math.max(
          0,
          (this.countSegments(this.getCacheDir(cacheKey)) -
            Math.max(0, job.lastRequestedSegment + 1)) *
            4,
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
    const activeDirectories = new Set([...this.jobs.keys()].map((key) => this.getCacheDir(key)));
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
    const activeDirectories = new Set([...this.jobs.keys()].map((key) => this.getCacheDir(key)));
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
    for (const pending of this.pendingSlots.splice(0)) {
      pending.reject(new Error('HLS_SERVICE_SHUTDOWN'));
    }
    this.reservedSlots.clear();
    this.inflightStarts.clear();
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

  private countSegments(outputDir: string) {
    try {
      return fs.readdirSync(outputDir).filter((name) => /^segment-\d{6}\.m4s$/.test(name)).length;
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
  ): Promise<string> {
    if (this.jobs.size + this.reservedSlots.size < this.maxActiveJobs) {
      const reservationId = crypto.randomUUID();
      this.reservedSlots.add(reservationId);
      return Promise.resolve(reservationId);
    }

    if (sessionId) this.cancelPendingSlots(sessionId);
    return new Promise<string>((resolve, reject) => {
      this.pendingSlots.push({
        id: crypto.randomUUID(),
        cacheKey,
        familyKey,
        sessionId,
        priority,
        queuedAt: Date.now(),
        mediaName,
        startSeconds,
        resolve,
        reject,
      });
      this.sortPendingSlots();
    });
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

  private cleanupOrphanedProcesses() {
    let entries: ProcessRegistryEntry[] = [];
    try {
      entries = JSON.parse(
        fs.readFileSync(this.processRegistryPath, 'utf8'),
      ) as ProcessRegistryEntry[];
    } catch {
      // A missing or invalid registry is equivalent to an empty registry.
    }

    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.pid) || entry.pid <= 0) continue;
      try {
        const command = execFileSync('ps', ['-p', String(entry.pid), '-o', 'command='], {
          encoding: 'utf8',
          timeout: 2_000,
        });
        if (
          command.includes(String(ffmpegPath)) &&
          command.includes(this.cacheRoot) &&
          command.includes('-f hls')
        ) {
          process.kill(entry.pid, 'SIGKILL');
        }
      } catch {
        // The process has already exited or cannot be inspected.
      }
    }
    this.persistProcessRegistry();
  }

  private unregisterProcess(jobId: string) {
    if (!this.processRegistry.delete(jobId)) return;
    this.persistProcessRegistry();
  }

  private persistProcessRegistry() {
    try {
      fs.writeFileSync(
        this.processRegistryPath,
        JSON.stringify([...this.processRegistry.values()]),
      );
    } catch {
      // Observability must never interrupt playback.
    }
  }

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

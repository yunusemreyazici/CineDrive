import type { PrismaClient } from '@cinedrive/prisma';
import { randomUUID } from 'node:crypto';
import { MetadataService } from './metadata.service.js';

export interface MetadataEnrichmentTarget {
  libraryId: string;
  mediaItemId: string;
  title: string;
  type: 'movie' | 'series';
  year?: number;
  refreshMedia: boolean;
  seriesId?: string;
  refreshEpisodes?: boolean;
}

const METADATA_ENRICHMENT_CONCURRENCY = 4;
const QUEUE_POLL_MS = 2_000;
const STALE_JOB_LEASE_MS = 2 * 60 * 1000;
const STALE_JOB_RECOVERY_INTERVAL_MS = 60 * 1000;
const MAX_JOB_ATTEMPTS = 8;
const INITIAL_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const ENQUEUE_BATCH_SIZE = 50;
const COMPLETED_JOB_REQUEUE_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Persists metadata work separately from catalogue scans and runs it with a
 * process-wide concurrency limit. Pending work survives restarts in SQLite.
 */
export class MetadataEnrichmentService {
  private readonly metadataService = new MetadataService();
  private readonly activeJobs = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private pumping = false;
  private lastStaleRecoveryAt = 0;

  constructor(private readonly prisma: PrismaClient) {}

  public start(): void {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => void this.pump(), QUEUE_POLL_MS);
    this.timer.unref();
    void this.pump();
  }

  public wake(): void {
    if (!this.stopped) void this.pump();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.controllers.values()) {
      controller.abort(new Error('METADATA_WORKER_SHUTDOWN'));
    }
    await Promise.allSettled(this.activeJobs.values());
  }

  /** Persist only real work; never store per-user provider secrets in the queue. */
  public async enqueueAfterIndexing(targets: readonly MetadataEnrichmentTarget[]): Promise<void> {
    const uniqueTargets = new Map<string, MetadataEnrichmentTarget>();
    for (const target of targets) {
      if (!target.refreshMedia && !target.refreshEpisodes) continue;
      const key = `${target.libraryId}\u0000${target.mediaItemId}`;
      const existing = uniqueTargets.get(key);
      uniqueTargets.set(key, {
        ...target,
        year: target.year ?? existing?.year,
        refreshMedia: target.refreshMedia || existing?.refreshMedia || false,
        refreshEpisodes: target.refreshEpisodes || existing?.refreshEpisodes || false,
        seriesId: target.seriesId ?? existing?.seriesId,
      });
    }

    const targetsByLibrary = new Map<string, MetadataEnrichmentTarget[]>();
    for (const target of uniqueTargets.values()) {
      const libraryTargets = targetsByLibrary.get(target.libraryId) || [];
      libraryTargets.push(target);
      targetsByLibrary.set(target.libraryId, libraryTargets);
    }

    for (const [libraryId, libraryTargets] of targetsByLibrary) {
      for (let offset = 0; offset < libraryTargets.length; offset += ENQUEUE_BATCH_SIZE) {
        const batch = libraryTargets.slice(offset, offset + ENQUEUE_BATCH_SIZE);
        const existingJobs = await this.prisma.metadataEnrichmentJob.findMany({
          where: {
            libraryId,
            mediaItemId: { in: batch.map((target) => target.mediaItemId) },
          },
        });
        const existingByMediaItem = new Map(
          existingJobs.map((job) => [job.mediaItemId, job]),
        );
        const createJobs: MetadataEnrichmentTarget[] = [];
        const refreshJobs: Array<{
          target: MetadataEnrichmentTarget;
          existingId: string;
          existingStatus: string;
          existingYear: number | null;
          existingSeriesId: string | null;
          refreshMedia: boolean;
          refreshEpisodes: boolean;
        }> = [];
        const requeueBefore = Date.now() - COMPLETED_JOB_REQUEUE_DELAY_MS;

        for (const target of batch) {
          const existing = existingByMediaItem.get(target.mediaItemId);
          if (!existing) {
            createJobs.push(target);
            continue;
          }
          // Keep claimed and delayed work intact. Completed no-match results
          // are retried at most daily instead of once per scheduled scan.
          if (existing.status === 'running') continue;
          if (existing.status === 'pending') {
            // A newer scan can discover episode work while an older job is
            // waiting in the queue. Merge its flags without moving its retry
            // time; the status predicate keeps an already claimed job safe.
            await this.prisma.metadataEnrichmentJob.updateMany({
              where: { id: existing.id, status: 'pending' },
              data: {
                title: target.title,
                type: target.type,
                year: target.year ?? existing.year,
                seriesId: target.seriesId || existing.seriesId || null,
                refreshMedia: target.refreshMedia || existing.refreshMedia,
                refreshEpisodes: target.refreshEpisodes || existing.refreshEpisodes,
              },
            });
            continue;
          }
          if (
            existing.status === 'completed' &&
            existing.completedAt &&
            existing.completedAt.getTime() > requeueBefore
          ) {
            continue;
          }
          if (existing.status !== 'completed' && existing.status !== 'failed') continue;
          refreshJobs.push({
            target,
            existingId: existing.id,
            existingStatus: existing.status,
            existingYear: existing.year,
            existingSeriesId: existing.seriesId,
            refreshMedia: existing.refreshMedia,
            refreshEpisodes: existing.refreshEpisodes,
          });
        }

        if (createJobs.length > 0) {
          await this.prisma.metadataEnrichmentJob.createMany({
            data: createJobs.map((target) => ({
              ...target,
              seriesId: target.seriesId || null,
              status: 'pending',
            })),
          });
        }
        for (const { target, ...existing } of refreshJobs) {
          // Compare the observed status in the write so enqueueing cannot
          // overwrite a job that another worker claimed after our read.
          await this.prisma.metadataEnrichmentJob.updateMany({
            where: { id: existing.existingId, status: existing.existingStatus },
            data: {
              title: target.title,
              type: target.type,
              year: target.year ?? existing.existingYear,
              seriesId: target.seriesId || existing.existingSeriesId || null,
              refreshMedia: target.refreshMedia || existing.refreshMedia,
              refreshEpisodes: target.refreshEpisodes || existing.refreshEpisodes,
              status: 'pending',
              attempts: 0,
              leaseToken: null,
              nextAttemptAt: new Date(),
              startedAt: null,
              completedAt: null,
              lastError: null,
            },
          });
        }
      }
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      await this.recoverStaleJobs();
      let available = METADATA_ENRICHMENT_CONCURRENCY - this.activeJobs.size;
      if (available <= 0) return;

      const jobs = await this.prisma.metadataEnrichmentJob.findMany({
        where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: available,
        select: { id: true },
      });

      for (const job of jobs) {
        if (this.stopped || available <= 0) break;
        if (this.activeJobs.has(job.id)) continue;
        const startedAt = new Date();
        const leaseToken = randomUUID();
        const claimed = await this.prisma.metadataEnrichmentJob.updateMany({
          where: { id: job.id, status: 'pending', nextAttemptAt: { lte: startedAt } },
          data: {
            status: 'running',
            attempts: { increment: 1 },
            leaseToken,
            startedAt,
            lastError: null,
          },
        });
        if (claimed.count === 0) continue;

        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        const task = Promise.resolve()
          .then(() => this.processJob(job.id, leaseToken, controller.signal))
          .catch((error: unknown) =>
            this.scheduleRetry(job.id, leaseToken, error, controller.signal),
          )
          .catch((error: unknown) => {
            console.warn(
              `[MetadataEnrichment] Job recovery failed for ${job.id} (${error instanceof Error ? error.name : 'unknown error'}).`,
            );
          })
          .finally(() => {
            this.controllers.delete(job.id);
            this.activeJobs.delete(job.id);
            if (!this.stopped) void this.pump();
          });
        this.activeJobs.set(job.id, task);
        available -= 1;
      }
    } catch (error) {
      console.warn(
        `[MetadataEnrichment] Queue poll failed (${error instanceof Error ? error.name : 'unknown error'}).`,
      );
    } finally {
      this.pumping = false;
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    const now = Date.now();
    if (now - this.lastStaleRecoveryAt < STALE_JOB_RECOVERY_INTERVAL_MS) return;
    this.lastStaleRecoveryAt = now;
    const staleBefore = new Date(now - STALE_JOB_LEASE_MS);
    await this.prisma.metadataEnrichmentJob.updateMany({
      where: { status: 'running', updatedAt: { lt: staleBefore } },
      data: {
        status: 'pending',
        leaseToken: null,
        startedAt: null,
        nextAttemptAt: new Date(),
        lastError: 'WORKER_RESTARTED',
      },
    });
  }

  private async processJob(
    jobId: string,
    leaseToken: string,
    signal: AbortSignal,
  ): Promise<void> {
    const job = await this.prisma.metadataEnrichmentJob.findUnique({
      where: { id: jobId },
      include: {
        library: { select: { user: { select: { tmdbApiKey: true } } } },
      },
    });
    if (!job || job.status !== 'running' || job.leaseToken !== leaseToken) return;
    signal.throwIfAborted();

    const [metadata, episodes] = await Promise.all([
      job.refreshMedia
        ? this.metadataService.fetchMetadata(
            job.title,
            job.type === 'series' ? 'series' : 'movie',
            job.library.user.tmdbApiKey || undefined,
            signal,
            { retryProviderFailures: true },
          )
        : Promise.resolve(null),
      job.refreshEpisodes && job.seriesId
        ? this.metadataService.fetchShowEpisodes(job.title, signal, {
            retryProviderFailures: true,
          })
        : Promise.resolve(null),
    ]);
    signal.throwIfAborted();
    if (!(await this.refreshLease(job.id, leaseToken))) return;

    if (metadata) {
      await this.prisma.mediaItem.updateMany({
        where: { id: job.mediaItemId, libraryId: job.libraryId },
        data: {
          year: job.year ?? metadata.year,
          overview: metadata.overview || undefined,
          posterUrl: metadata.posterUrl || undefined,
          backdropUrl: metadata.backdropUrl || undefined,
          voteAverage: metadata.voteAverage,
          voteCount: metadata.voteCount,
          genres: metadata.genres ? JSON.stringify(metadata.genres) : undefined,
          cast: metadata.cast ? JSON.stringify(metadata.cast) : undefined,
          trailerUrl: metadata.trailerUrl,
          contentRating: metadata.contentRating,
          tmdbId: metadata.tmdbId,
          imdbId: metadata.imdbId,
        },
      });
    }

    if (episodes && job.seriesId) {
      const rows = await this.prisma.episode.findMany({
        where: { seriesId: job.seriesId },
        select: { id: true, seasonNumber: true, episodeNumber: true },
      });
      for (let index = 0; index < rows.length; index += 1) {
        const episode = rows[index]!;
        signal.throwIfAborted();
        if (
          index > 0 &&
          index % 25 === 0 &&
          !(await this.refreshLease(job.id, leaseToken))
        ) {
          return;
        }
        const remote = episodes.get(`${episode.seasonNumber}x${episode.episodeNumber}`);
        if (!remote) continue;
        await this.prisma.episode.updateMany({
          where: { id: episode.id },
          data: {
            title: remote.name,
            overview: remote.overview || undefined,
            stillUrl: remote.stillUrl || undefined,
          },
        });
      }
    }

    await this.prisma.metadataEnrichmentJob.updateMany({
      where: { id: job.id, status: 'running', leaseToken },
      data: {
        status: 'completed',
        leaseToken: null,
        refreshMedia: false,
        refreshEpisodes: false,
        completedAt: new Date(),
        startedAt: null,
        lastError: null,
      },
    });
  }

  private async refreshLease(jobId: string, leaseToken: string): Promise<boolean> {
    const result = await this.prisma.metadataEnrichmentJob.updateMany({
      where: { id: jobId, status: 'running', leaseToken },
      data: { startedAt: new Date() },
    });
    return result.count === 1;
  }

  private async scheduleRetry(
    jobId: string,
    leaseToken: string,
    error: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      await this.prisma.metadataEnrichmentJob.updateMany({
        where: { id: jobId, status: 'running', leaseToken },
        data: { status: 'pending', leaseToken: null, startedAt: null, nextAttemptAt: new Date() },
      });
      return;
    }

    const job = await this.prisma.metadataEnrichmentJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, status: true, leaseToken: true },
    });
    if (!job || job.status !== 'running' || job.leaseToken !== leaseToken) return;
    const exhausted = job.attempts >= MAX_JOB_ATTEMPTS;
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, job.attempts - 1),
    );
    await this.prisma.metadataEnrichmentJob.updateMany({
      where: { id: jobId, status: 'running', leaseToken },
      data: {
        status: exhausted ? 'failed' : 'pending',
        leaseToken: null,
        startedAt: null,
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: error instanceof Error ? error.name : 'METADATA_ENRICHMENT_FAILED',
      },
    });
    console.warn(
      `[MetadataEnrichment] Job ${jobId} ${exhausted ? 'failed' : 'will retry'} (${error instanceof Error ? error.name : 'unknown error'}).`,
    );
  }
}

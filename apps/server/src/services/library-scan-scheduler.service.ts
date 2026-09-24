import type { PrismaClient } from '@cinedrive/prisma';
import type { LibraryScanService } from './library-scan.service.js';
import type { LocalScanService } from './local-scan.service.js';

const MAX_SCHEDULER_POLL_MS = 5 * 60 * 1000;
const SCAN_STATUS_POLL_MS = 5_000;

export class LibraryScanSchedulerService {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private activeRun?: Promise<void>;
  private runController?: AbortController;
  private readonly intervalMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly driveScan: LibraryScanService,
    private readonly localScan: LocalScanService,
    intervalHours: number,
  ) {
    this.intervalMs = intervalHours * 60 * 60 * 1000;
  }

  public start(): void {
    if (this.stopped) return;
    if (this.intervalMs > 0 && !this.timer) {
      this.timer = setInterval(
        () => void this.runDueScans(),
        Math.min(this.intervalMs, MAX_SCHEDULER_POLL_MS),
      );
      this.timer.unref();
    }
    // Recovery of a scan interrupted by a restart is independent of whether
    // periodic scheduling is enabled.
    void this.runDueScans();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.runController?.abort(new Error('SCAN_SCHEDULER_SHUTDOWN'));
    await this.activeRun;
  }

  private runDueScans(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.activeRun) return this.activeRun;
    const controller = new AbortController();
    this.runController = controller;
    this.activeRun = this.scanDueLibraries(controller.signal).finally(() => {
      this.activeRun = undefined;
      if (this.runController === controller) this.runController = undefined;
    });
    return this.activeRun;
  }

  private async scanDueLibraries(signal: AbortSignal): Promise<void> {
    try {
      const libraries = await this.prisma.library.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          storageType: true,
          createdAt: true,
          lastScannedAt: true,
          lastScheduledScanAttemptAt: true,
        },
      });

      for (const library of libraries) {
        if (this.stopped || signal.aborted) return;
        const latestScan = await this.prisma.libraryScan.findFirst({
          where: { libraryId: library.id },
          orderBy: { startedAt: 'desc' },
          select: { id: true, status: true, startedAt: true, completedAt: true },
        });
        if (latestScan?.status === 'running') continue;

        const interrupted = latestScan?.status === 'interrupted';
        const lastRunAt =
          latestScan?.completedAt ||
          latestScan?.startedAt ||
          library.lastScannedAt ||
          library.createdAt;
        const mostRecentAttemptAt =
          library.lastScheduledScanAttemptAt && library.lastScheduledScanAttemptAt > lastRunAt
            ? library.lastScheduledScanAttemptAt
            : lastRunAt;
        if (!interrupted) {
          if (this.intervalMs <= 0) continue;
          if (Date.now() - mostRecentAttemptAt.getTime() < this.intervalMs) continue;
        }

        try {
          await this.prisma.library.update({
            where: { id: library.id },
            data: { lastScheduledScanAttemptAt: new Date() },
          });
          if (library.storageType === 'local') {
            const scanId = await this.localScan.startLocalScan(library.id);
            await this.waitForScan(scanId);
            continue;
          }

          const sources = await this.prisma.driveScanSource.findMany({
            where: { libraryId: library.id },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (sources.length === 0) {
            const scanId = await this.driveScan.scanLibrary(library.userId, library.id);
            await this.waitForScan(scanId);
            continue;
          }

          for (const source of sources) {
            if (this.stopped || signal.aborted) return;
            try {
              const scanId = await this.driveScan.scanSourceIfChanged(
                library.userId,
                library.id,
                source.id,
                signal,
              );
              await this.waitForScan(scanId);
            } catch (error) {
              if (this.stopped || signal.aborted) return;
              console.warn(
                `[LibraryScanScheduler] Drive source ${source.id} was skipped (${error instanceof Error ? error.name : 'unknown error'}).`,
              );
            }
          }
        } catch (error) {
          if (this.stopped || signal.aborted) return;
          console.warn(
            `[LibraryScanScheduler] Scan could not start for library ${library.id} (${error instanceof Error ? error.name : 'unknown error'}).`,
          );
        }
      }
    } catch (error) {
      console.warn(
        `[LibraryScanScheduler] Schedule check failed (${error instanceof Error ? error.name : 'unknown error'}).`,
      );
    }
  }

  private async waitForScan(scanId: string): Promise<void> {
    while (!this.stopped) {
      const scan = await this.prisma.libraryScan.findUnique({
        where: { id: scanId },
        select: { status: true },
      });
      if (!scan || scan.status !== 'running') return;
      await new Promise<void>((resolve) => setTimeout(resolve, SCAN_STATUS_POLL_MS));
    }
  }
}

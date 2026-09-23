import type { PrismaClient } from '@cinedrive/prisma';
import type { LibraryScanService } from './library-scan.service.js';
import type { LocalScanService } from './local-scan.service.js';

const MAX_SCHEDULER_POLL_MS = 5 * 60 * 1000;
const SCAN_STATUS_POLL_MS = 5_000;

export class LibraryScanSchedulerService {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private activeRun?: Promise<void>;
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

  public stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private runDueScans(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.scanDueLibraries().finally(() => {
      this.activeRun = undefined;
    });
    return this.activeRun;
  }

  private async scanDueLibraries(): Promise<void> {
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
        if (this.stopped) return;
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
          const scanId =
            library.storageType === 'local'
              ? await this.localScan.startLocalScan(library.id)
              : await this.driveScan.scanLibrary(library.userId, library.id);
          await this.waitForScan(scanId);
        } catch (error) {
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

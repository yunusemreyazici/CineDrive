import type { PrismaClient } from '@prisma/client';

export type ScanInterruptionReason = 'server_restarted' | 'server_shutdown' | 'watchdog_timeout';

interface ActiveScan {
  libraryId: string;
  sourceIds: string[];
  controller: AbortController;
  onInterrupted?: () => void;
  lastHeartbeatAt: number;
  lastPersistedHeartbeatAt: number;
}

const HEARTBEAT_PERSIST_INTERVAL_MS = 5_000;
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_TIMEOUT_MS = 120_000;

/**
 * Owns the process-local portion of scan state and reconciles it with the DB.
 * A DB row marked running without an entry here belongs to a previous process.
 */
export class ScanLifecycleService {
  private readonly activeScans = new Map<string, ActiveScan>();
  private watchdogTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient) {}

  public register(
    scanId: string,
    libraryId: string,
    sourceIds: string[] = [],
    onInterrupted?: () => void,
  ): AbortSignal {
    const controller = new AbortController();
    const now = Date.now();
    this.activeScans.set(scanId, {
      libraryId,
      sourceIds,
      controller,
      onInterrupted,
      lastHeartbeatAt: now,
      lastPersistedHeartbeatAt: now,
    });
    return controller.signal;
  }

  public isScanActive(scanId: string): boolean {
    return this.activeScans.has(scanId);
  }

  public startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => void this.interruptStalledScans(), WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref();
  }

  public async heartbeat(scanId: string, force = false): Promise<void> {
    const active = this.activeScans.get(scanId);
    if (!active) return;
    const now = Date.now();
    active.lastHeartbeatAt = now;
    if (!force && now - active.lastPersistedHeartbeatAt < HEARTBEAT_PERSIST_INTERVAL_MS) return;
    active.lastPersistedHeartbeatAt = now;
    await this.prisma.libraryScan
      .updateMany({
        where: { id: scanId, status: 'running' },
        data: { heartbeatAt: new Date(now) },
      })
      .catch(() => {});
  }

  public finish(scanId: string): void {
    this.activeScans.delete(scanId);
  }

  public async reconcileAbandonedScans(
    options: {
      userId?: string;
      reason?: ScanInterruptionReason;
    } = {},
  ): Promise<number> {
    const scans = await this.prisma.libraryScan.findMany({
      where: {
        status: 'running',
        ...(options.userId ? { library: { userId: options.userId } } : {}),
      },
      select: {
        id: true,
        libraryId: true,
        driveScanSourceId: true,
        startedAt: true,
      },
    });
    const abandoned = scans.filter((scan) => !this.activeScans.has(scan.id));
    for (const scan of abandoned) {
      await this.finalizeInterruptedScan(scan, options.reason || 'server_restarted');
    }
    return abandoned.length;
  }

  public async shutdown(): Promise<void> {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = undefined;
    const scanIds = Array.from(this.activeScans.keys());
    await Promise.all(scanIds.map((scanId) => this.interruptScan(scanId, 'server_shutdown')));
  }

  private async interruptStalledScans(): Promise<void> {
    const now = Date.now();
    const stalled = Array.from(this.activeScans.entries())
      .filter(([, scan]) => now - scan.lastHeartbeatAt >= WATCHDOG_TIMEOUT_MS)
      .map(([scanId]) => scanId);
    await Promise.all(stalled.map((scanId) => this.interruptScan(scanId, 'watchdog_timeout')));
  }

  private async interruptScan(scanId: string, reason: ScanInterruptionReason): Promise<void> {
    const active = this.activeScans.get(scanId);
    if (!active) return;
    active.controller.abort(new Error(reason));
    active.onInterrupted?.();
    const scan = await this.prisma.libraryScan.findUnique({
      where: { id: scanId },
      select: { id: true, libraryId: true, driveScanSourceId: true, startedAt: true },
    });
    if (scan) await this.finalizeInterruptedScan(scan, reason, active.sourceIds);
    this.activeScans.delete(scanId);
  }

  private async finalizeInterruptedScan(
    scan: {
      id: string;
      libraryId: string;
      driveScanSourceId: string | null;
      startedAt: Date;
    },
    reason: ScanInterruptionReason,
    knownSourceIds: string[] = [],
  ): Promise<void> {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - scan.startedAt.getTime());
    const activeSourceIds = new Set(
      Array.from(this.activeScans.values()).flatMap((active) =>
        active.libraryId === scan.libraryId ? active.sourceIds : [],
      ),
    );
    const sourceIds = new Set([
      ...knownSourceIds,
      ...(scan.driveScanSourceId ? [scan.driveScanSourceId] : []),
    ]);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.libraryScan.updateMany({
        where: { id: scan.id, status: 'running' },
        data: {
          status: 'interrupted',
          completedAt,
          durationMs,
          heartbeatAt: completedAt,
          interruptionReason: reason,
        },
      });
      if (count === 0) return;

      const sourceWhere = sourceIds.size
        ? { id: { in: Array.from(sourceIds) }, lastScanStatus: 'running' }
        : {
            libraryId: scan.libraryId,
            lastScanStatus: 'running',
            ...(activeSourceIds.size ? { id: { notIn: Array.from(activeSourceIds) } } : {}),
          };
      await tx.driveScanSource.updateMany({
        where: sourceWhere,
        data: {
          lastScanStatus: 'interrupted',
          lastScannedAt: completedAt,
          lastScanDurationMs: durationMs,
          lastScanInterruptionReason: reason,
        },
      });
    });
  }
}

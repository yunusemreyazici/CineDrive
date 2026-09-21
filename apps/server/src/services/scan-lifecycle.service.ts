import { performance } from 'node:perf_hooks';
import type { PrismaClient } from '@cinedrive/prisma';

export type ScanInterruptionReason =
  'server_restarted' | 'server_shutdown' | 'watchdog_timeout' | 'library_operation_lost';

export class ScanInterruptedError extends Error {
  public readonly reason: ScanInterruptionReason;

  constructor(reason: ScanInterruptionReason) {
    super(`SCAN_INTERRUPTED:${reason}`);
    this.name = 'ScanInterruptedError';
    this.reason = reason;
  }
}

export const isScanInterruptedError = (error: unknown): boolean =>
  error instanceof ScanInterruptedError ||
  (error instanceof Error && error.message.startsWith('SCAN_INTERRUPTED:'));

interface ActiveScan {
  libraryId: string;
  sourceIds: string[];
  controller: AbortController;
  onInterrupted?: () => void;
  onHeartbeat?: () => Promise<boolean>;
  lastHeartbeatAt: number;
  lastPersistedHeartbeatAt: number;
  heartbeatRefresh?: Promise<boolean>;
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
    onHeartbeat?: () => Promise<boolean>,
  ): AbortSignal {
    const controller = new AbortController();
    const now = Date.now();
    this.activeScans.set(scanId, {
      libraryId,
      sourceIds,
      controller,
      onInterrupted,
      onHeartbeat,
      lastHeartbeatAt: now,
      // Make the first non-forced heartbeat perform a real lease check while
      // keeping subsequent item-level calls cheap.
      lastPersistedHeartbeatAt: performance.now() - HEARTBEAT_PERSIST_INTERVAL_MS,
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
    if (active.controller.signal.aborted) {
      throw active.controller.signal.reason instanceof Error
        ? active.controller.signal.reason
        : new ScanInterruptedError('server_shutdown');
    }
    const now = Date.now();
    active.lastHeartbeatAt = now;
    const monotonicNow = performance.now();
    if (
      !force &&
      monotonicNow - active.lastPersistedHeartbeatAt < HEARTBEAT_PERSIST_INTERVAL_MS
    ) {
      // The signal check above is intentionally the hot path for every item.
      // Lease extension and the LibraryScan status write happen periodically.
      return;
    }

    const refresh =
      active.heartbeatRefresh || this.refreshHeartbeat(scanId, active, now, monotonicNow);
    active.heartbeatRefresh = refresh;
    try {
      const owned = await refresh;
      if (!owned) {
        const interruption = new ScanInterruptedError('library_operation_lost');
        await this.interruptScan(scanId, 'library_operation_lost', interruption).catch(() => {
          // The abort signal is the hard stop. If DB finalization is
          // temporarily unavailable, startup reconciliation can repair the
          // running row after the process has stopped using it.
        });
        throw interruption;
      }
    } finally {
      if (active.heartbeatRefresh === refresh) active.heartbeatRefresh = undefined;
    }
  }

  private async refreshHeartbeat(
    scanId: string,
    active: ActiveScan,
    now: number,
    monotonicNow: number,
  ): Promise<boolean> {
    const owned = active.onHeartbeat ? await active.onHeartbeat().catch(() => false) : true;
    if (!owned) return false;

    // Record the timestamp only after the lease refresh succeeded. The
    // monotonic clock is immune to wall-clock adjustments on the host.
    active.lastPersistedHeartbeatAt = Math.max(monotonicNow, performance.now());
    await this.prisma.libraryScan
      .updateMany({
        where: { id: scanId, status: 'running' },
        data: { heartbeatAt: new Date(now) },
      })
      .catch(() => {});
    return true;
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

  private async interruptScan(
    scanId: string,
    reason: ScanInterruptionReason,
    abortReason = new ScanInterruptedError(reason),
  ): Promise<void> {
    const active = this.activeScans.get(scanId);
    if (!active) return;
    try {
      active.controller.abort(abortReason);
      active.onInterrupted?.();
      const scan = await this.prisma.libraryScan.findUnique({
        where: { id: scanId },
        select: { id: true, libraryId: true, driveScanSourceId: true, startedAt: true },
      });
      if (scan) await this.finalizeInterruptedScan(scan, reason, active.sourceIds);
    } finally {
      this.activeScans.delete(scanId);
    }
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

import crypto from 'node:crypto';
import type { HlsQueueInfo } from './hls-types.js';

/**
 * Admission control for transcode slots.
 *
 * Encoding is the scarce resource, so only `maxActiveJobs` may run at once and
 * everything else waits in a priority queue. The scheduler tracks reservations
 * separately from running jobs: a caller holds a reservation across the async
 * gap between winning a slot and actually spawning FFmpeg, which is what stops
 * two concurrent requests from both believing capacity was free.
 *
 * It has no knowledge of jobs — the count of running encoders is supplied by
 * the owner through `activeJobCount`.
 */

/** A queued request must not wait forever for a slot that may never free up. */
const PENDING_SLOT_TIMEOUT_MS = 90_000;

/** A seek outranks a fresh start: someone is already watching. */
export const SEEK_PRIORITY = 2;
export const NORMAL_PRIORITY = 1;

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

export interface ReserveSlotOptions {
  cacheKey: string;
  familyKey: string;
  sessionId?: string;
  priority: number;
  mediaName: string;
  startSeconds: number;
  signal?: AbortSignal;
}

export class HlsSlotScheduler {
  private readonly pendingSlots: PendingSlot[] = [];
  private readonly reservedSlots = new Set<string>();

  constructor(
    public readonly maxActiveJobs: number,
    private readonly activeJobCount: () => number,
  ) {}

  public get queueLength() {
    return this.pendingSlots.length;
  }

  private get hasCapacity() {
    return this.activeJobCount() + this.reservedSlots.size < this.maxActiveJobs;
  }

  public reserve({
    cacheKey,
    familyKey,
    sessionId,
    priority,
    mediaName,
    startSeconds,
    signal,
  }: ReserveSlotOptions): Promise<string> {
    if (this.hasCapacity) {
      const reservationId = crypto.randomUUID();
      this.reservedSlots.add(reservationId);
      return Promise.resolve(reservationId);
    }

    // One session waiting on two slots at once means the earlier request has
    // been superseded — a viewer scrubbing the timeline, typically.
    if (sessionId) this.cancelForSession(sessionId);

    return new Promise<string>((resolve, reject) => {
      const id = crypto.randomUUID();

      // Without this a client that disconnected while queued still eventually
      // won a slot and started a full job for nobody.
      const timeout = setTimeout(() => {
        this.removePending(id, new Error('HLS_QUEUE_TIMEOUT'));
      }, PENDING_SLOT_TIMEOUT_MS);
      timeout.unref();

      const onAbort = () => this.removePending(id, new Error('HLS_CLIENT_ABORTED'));
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
      this.sort();
    });
  }

  /** Called once a reservation has become a running job. */
  public consume(reservationId: string) {
    this.reservedSlots.delete(reservationId);
  }

  /** Called when a reservation ends without becoming a job. */
  public release(reservationId: string) {
    if (!this.reservedSlots.delete(reservationId)) return;
    this.drain();
  }

  /** Hands freed capacity to the highest-priority waiters. */
  public drain() {
    this.sort();
    while (this.pendingSlots.length > 0 && this.hasCapacity) {
      const pending = this.pendingSlots.shift()!;
      const reservationId = pending.id;
      this.reservedSlots.add(reservationId);
      pending.dispose();
      pending.resolve(reservationId);
    }
  }

  public cancelForSession(sessionId: string, cacheKey?: string) {
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

  public snapshot(): HlsQueueInfo[] {
    const now = Date.now();
    return this.pendingSlots.map((pending) => ({
      id: pending.id,
      mediaName: pending.mediaName,
      startSeconds: pending.startSeconds,
      priority: pending.priority > NORMAL_PRIORITY ? 'seek' : 'normal',
      queuedAt: new Date(pending.queuedAt).toISOString(),
      waitMs: now - pending.queuedAt,
    }));
  }

  public shutdown() {
    for (const pending of this.pendingSlots.splice(0)) {
      pending.dispose();
      pending.reject(new Error('HLS_SERVICE_SHUTDOWN'));
    }
    this.reservedSlots.clear();
  }

  private removePending(id: string, error: Error) {
    const index = this.pendingSlots.findIndex((pending) => pending.id === id);
    if (index < 0) return;
    const [pending] = this.pendingSlots.splice(index, 1);
    pending!.dispose();
    pending!.reject(error);
  }

  private sort() {
    this.pendingSlots.sort(
      (left, right) => right.priority - left.priority || left.queuedAt - right.queuedAt,
    );
  }
}

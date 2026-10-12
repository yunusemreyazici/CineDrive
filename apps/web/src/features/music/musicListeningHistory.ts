export interface MusicListeningEvent {
  eventId: string;
  trackId: string;
  listenedSeconds: number;
  playedAt: string;
}

/** Media position is not listening time. A seek/buffer/pause breaks continuity;
 * credited progress never exceeds elapsed monotonic wall time. */
export class MusicListeningSession {
  private previous: { position: number; time: number } | null = null;
  private seconds = 0;
  private finalized = false;
  constructor(
    private readonly eventId: string,
    private readonly trackId: string,
    private readonly duration: number | null | undefined,
    private readonly playedAt = new Date().toISOString(),
  ) {}

  sample(position: number, monotonicSeconds: number, playing: boolean) {
    if (
      this.finalized ||
      !playing ||
      !Number.isFinite(position) ||
      !Number.isFinite(monotonicSeconds)
    ) {
      this.discontinuity();
      return;
    }
    const previous = this.previous;
    this.previous = { position, time: monotonicSeconds };
    if (!previous) return;
    const elapsed = monotonicSeconds - previous.time;
    const advanced = position - previous.position;
    if (elapsed > 0 && advanced > 0 && advanced <= elapsed + 1)
      this.seconds += Math.min(elapsed, advanced);
  }
  discontinuity() {
    this.previous = null;
  }
  finalize(): MusicListeningEvent | null {
    if (this.finalized) return null;
    this.finalized = true;
    const threshold =
      this.duration && Number.isFinite(this.duration) && this.duration > 0
        ? Math.min(30, this.duration)
        : 30;
    if (this.seconds + 0.5 < threshold) return null;
    return {
      eventId: this.eventId,
      trackId: this.trackId,
      listenedSeconds: this.seconds,
      playedAt: this.playedAt,
    };
  }
}

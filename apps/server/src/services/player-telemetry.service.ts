export type PlayerTelemetryEvent = {
  mediaId: string;
  driveFileId: string;
  browser: 'safari' | 'chromium' | 'other';
  playbackMode: 'direct' | 'audio' | 'hls' | 'full';
  event: 'first-frame' | 'stall' | 'seek-recovery' | 'error';
  durationMs?: number;
  occurredAt: number;
};

export class PlayerTelemetryService {
  private readonly events: PlayerTelemetryEvent[] = [];
  private readonly maxEvents = 500;

  public record(event: PlayerTelemetryEvent) {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  public getStats() {
    const durations = (eventName: PlayerTelemetryEvent['event']) =>
      this.events
        .filter((event) => event.event === eventName && typeof event.durationMs === 'number')
        .map((event) => event.durationMs!);
    const average = (values: number[]) =>
      values.length
        ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
        : 0;
    const firstFrames = durations('first-frame');
    const stalls = durations('stall');
    const seeks = durations('seek-recovery');

    return {
      sampleCount: this.events.length,
      firstFrameAverageMs: average(firstFrames),
      stallCount: stalls.length,
      stallAverageMs: average(stalls),
      seekCount: seeks.length,
      seekRecoveryAverageMs: average(seeks),
      errorCount: this.events.filter((event) => event.event === 'error').length,
      recent: this.events.slice(-10).reverse(),
    };
  }
}

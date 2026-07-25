import { describe, expect, it } from 'vitest';
import { PlayerTelemetryService } from '../src/services/player-telemetry.service';

describe('PlayerTelemetryService', () => {
  it('aggregates playback quality timings and errors', () => {
    const service = new PlayerTelemetryService();
    const base = {
      mediaId: 'media-one',
      driveFileId: 'drive-one',
      browser: 'safari' as const,
      playbackMode: 'hls' as const,
      occurredAt: Date.now(),
    };

    service.record({ ...base, event: 'first-frame', durationMs: 800 });
    service.record({ ...base, event: 'first-frame', durationMs: 1200 });
    service.record({ ...base, event: 'stall', durationMs: 500 });
    service.record({ ...base, event: 'seek-recovery', durationMs: 1500 });
    service.record({ ...base, event: 'error' });

    expect(service.getStats()).toMatchObject({
      sampleCount: 5,
      firstFrameAverageMs: 1000,
      stallCount: 1,
      stallAverageMs: 500,
      seekCount: 1,
      seekRecoveryAverageMs: 1500,
      errorCount: 1,
    });
  });
});

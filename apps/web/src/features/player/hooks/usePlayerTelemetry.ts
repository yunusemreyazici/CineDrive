import { useCallback, useEffect } from 'react';
import type { PlaybackMode } from '../../../types/media';
import { getBrowserFamily } from '../utils/playerBrowser';

export type TelemetryEvent = 'first-frame' | 'stall' | 'seek-recovery' | 'error';

interface UsePlayerTelemetryOptions {
  mediaId: string;
  driveFileId: string | null;
  isSafari: boolean;
  playbackMode: PlaybackMode;
  sessionId: string;
  /** Present only while a transcode/HLS job is running server-side. */
  startOffset: number;
}

/**
 * Reports quality-of-experience events and releases the server-side FFmpeg job
 * when playback stops. Both are fire-and-forget: a failure here must never
 * affect playback.
 */
export const usePlayerTelemetry = ({
  mediaId,
  driveFileId,
  isSafari,
  playbackMode,
  sessionId,
  startOffset,
}: UsePlayerTelemetryOptions) => {
  const report = useCallback(
    (event: TelemetryEvent, durationMs?: number) => {
      if (!driveFileId) return;

      void fetch('/api/insights/player-telemetry', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId,
          driveFileId,
          browser: getBrowserFamily(isSafari),
          playbackMode,
          event,
          durationMs,
        }),
      }).catch(() => {
        // QoE measurements must never affect playback.
      });
    },
    [driveFileId, isSafari, mediaId, playbackMode],
  );

  // Tell the server the job can go as soon as this source is replaced or the
  // page goes away; its idle timeout is only the backstop.
  useEffect(() => {
    if (playbackMode === 'direct' || !driveFileId) return;

    const releaseUrl =
      playbackMode === 'hls'
        ? `/api/media/${driveFileId}/hls/release?start=${startOffset}&session=${sessionId}`
        : `/api/media/transcode/release?session=${sessionId}`;

    const releaseStream = () => {
      void fetch(releaseUrl, { method: 'POST', credentials: 'include', keepalive: true }).catch(
        () => {
          // The server-side idle timeout remains a fallback for abrupt exits.
        },
      );
    };

    window.addEventListener('pagehide', releaseStream);
    return () => {
      window.removeEventListener('pagehide', releaseStream);
      releaseStream();
    };
  }, [driveFileId, playbackMode, sessionId, startOffset]);

  return report;
};

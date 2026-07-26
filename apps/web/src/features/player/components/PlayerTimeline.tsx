import React, { useEffect, useRef, useState } from 'react';

interface PlayerTimelineProps {
  currentTime: number;
  duration: number;
  bufferedTime?: number;
  previewDriveFileId?: string;
  onSeek: (time: number) => void;
}

/** Preview thumbnails are generated on 10s boundaries server-side. */
const PREVIEW_STEP_SECONDS = 10;
const PREVIEW_HOVER_DELAY_MS = 220;
/** Half the tooltip width, so it never hangs off either end of the bar. */
const TOOLTIP_HALF_WIDTH_PX = 88;
const KEYBOARD_SEEK_SECONDS = 5;

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const PlayerTimeline: React.FC<PlayerTimelineProps> = ({
  currentTime,
  duration,
  bufferedTime = 0,
  previewDriveFileId,
  onSeek,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    // Clearing on hover-out is handled by the mouse-leave handler, so the
    // effect only ever schedules work rather than setting state synchronously.
    if (hoverTime === null || !previewDriveFileId) return;

    const timer = window.setTimeout(() => {
      setPreviewFailed(false);
      setPreviewTime(Math.floor(hoverTime / PREVIEW_STEP_SECONDS) * PREVIEW_STEP_SECONDS);
    }, PREVIEW_HOVER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hoverTime, previewDriveFileId]);

  const calculateTimeFromEvent = (e: React.MouseEvent | React.TouchEvent) => {
    if (!progressBarRef.current || duration <= 0) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX =
      'touches' in e && e.touches.length > 0 && e.touches[0]
        ? e.touches[0].clientX
        : (e as React.MouseEvent).clientX;

    const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (offsetX / rect.width) * duration;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    setHoverTime(calculateTimeFromEvent(e));
    setHoverPosition(e.clientX - rect.left);
    // Measured here rather than read from the ref during render — the render
    // pass must not depend on live DOM geometry.
    setTrackWidth(rect.width);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    setPreviewTime(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (duration <= 0) return;

    const seekTo = (time: number) => {
      e.preventDefault();
      onSeek(Math.max(0, Math.min(duration, time)));
    };

    switch (e.key) {
      case 'ArrowLeft':
        return seekTo(currentTime - KEYBOARD_SEEK_SECONDS);
      case 'ArrowRight':
        return seekTo(currentTime + KEYBOARD_SEEK_SECONDS);
      case 'Home':
        return seekTo(0);
      case 'End':
        return seekTo(duration);
      case 'PageDown':
        return seekTo(currentTime - KEYBOARD_SEEK_SECONDS * 6);
      case 'PageUp':
        return seekTo(currentTime + KEYBOARD_SEEK_SECONDS * 6);
      default:
        return undefined;
    }
  };

  const currentPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (bufferedTime / duration) * 100 : 0;

  return (
    <div
      ref={progressBarRef}
      // A native slider so the scrub bar is reachable and operable by keyboard,
      // and announced with its position rather than as an anonymous div.
      role="slider"
      tabIndex={0}
      aria-label="Oynatma konumu"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(duration))}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
      onClick={(e) => onSeek(calculateTimeFromEvent(e))}
      onKeyDown={handleKeyDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative flex h-3 w-full cursor-pointer select-none items-center py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      {/* Background Track */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80 transition-all group-hover:h-2.5">
        {/* Buffered Portion */}
        <div
          className="absolute bottom-0 left-0 top-0 rounded-full bg-zinc-600/50 transition-all"
          style={{ width: `${Math.min(100, bufferedPercent)}%` }}
        />

        {/* Played Portion */}
        <div
          className="absolute bottom-0 left-0 top-0 rounded-full bg-brand-500 transition-all"
          style={{ width: `${Math.min(100, currentPercent)}%` }}
        />
      </div>

      {/* Thumb Indicator */}
      <div
        className="absolute h-3.5 w-3.5 -translate-x-1/2 transform rounded-full border border-brand-500 bg-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ left: `${currentPercent}%` }}
      />

      {/* Hover Time Tooltip */}
      {hoverTime !== null && (
        <div
          className="pointer-events-none absolute bottom-5 z-40 w-44 -translate-x-1/2 overflow-hidden rounded-lg border border-white/15 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
          style={{
            left: `${Math.max(
              TOOLTIP_HALF_WIDTH_PX,
              Math.min(hoverPosition, trackWidth - TOOLTIP_HALF_WIDTH_PX),
            )}px`,
          }}
        >
          {previewDriveFileId && previewTime !== null && !previewFailed ? (
            <img
              src={`/api/media/${encodeURIComponent(previewDriveFileId)}/preview?time=${previewTime}`}
              alt=""
              className="aspect-video w-full bg-zinc-900 object-cover"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-zinc-900 text-[10px] font-medium text-zinc-500">
              {previewDriveFileId && !previewFailed ? 'Önizleme hazırlanıyor…' : 'Önizleme yok'}
            </div>
          )}
          <div className="px-2.5 py-1.5 text-center text-[11px] font-bold text-white">
            {formatTime(hoverTime)}
          </div>
        </div>
      )}
    </div>
  );
};

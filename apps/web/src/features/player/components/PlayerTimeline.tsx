import React, { useEffect, useRef, useState } from 'react';

interface PlayerTimelineProps {
  currentTime: number;
  duration: number;
  bufferedTime?: number;
  previewDriveFileId?: string;
  onSeek: (time: number) => void;
}

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
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (hoverTime === null || !previewDriveFileId) {
      setPreviewTime(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setPreviewFailed(false);
      setPreviewTime(Math.floor(hoverTime / 10) * 10);
    }, 220);
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
    const percentage = offsetX / rect.width;
    return percentage * duration;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!progressBarRef.current || duration <= 0) return;
    const time = calculateTimeFromEvent(e);
    const rect = progressBarRef.current.getBoundingClientRect();
    setHoverTime(time);
    setHoverPosition(e.clientX - rect.left);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    setPreviewTime(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    const targetTime = calculateTimeFromEvent(e);
    onSeek(targetTime);
  };

  const currentPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (bufferedTime / duration) * 100 : 0;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      ref={progressBarRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-full h-3 flex items-center cursor-pointer group select-none py-1"
    >
      {/* Background Track */}
      <div className="w-full h-1.5 group-hover:h-2.5 bg-zinc-800/80 rounded-full overflow-hidden transition-all relative">
        {/* Buffered Portion */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-zinc-600/50 rounded-full transition-all"
          style={{ width: `${Math.min(100, bufferedPercent)}%` }}
        />

        {/* Played Portion */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-brand-500 rounded-full transition-all"
          style={{ width: `${Math.min(100, currentPercent)}%` }}
        />
      </div>

      {/* Thumb Indicator */}
      <div
        className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-md border border-brand-500 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ left: `${currentPercent}%` }}
      />

      {/* Hover Time Tooltip */}
      {hoverTime !== null && (
        <div
          className="pointer-events-none absolute bottom-5 z-40 w-44 -translate-x-1/2 overflow-hidden rounded-lg border border-white/15 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
          style={{
            left: `${Math.max(88, Math.min(hoverPosition, (progressBarRef.current?.clientWidth || 0) - 88))}px`,
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

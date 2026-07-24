import React, { useRef, useState } from 'react';

interface PlayerTimelineProps {
  currentTime: number;
  duration: number;
  bufferedTime?: number;
  onSeek: (time: number) => void;
}

export const PlayerTimeline: React.FC<PlayerTimelineProps> = ({
  currentTime,
  duration,
  bufferedTime = 0,
  onSeek,
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);

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
          className="absolute bottom-5 -translate-x-1/2 px-2 py-1 bg-zinc-900/90 border border-zinc-700 text-[11px] font-bold text-white rounded-md backdrop-blur-md pointer-events-none"
          style={{ left: `${hoverPosition}px` }}
        >
          {formatTime(hoverTime)}
        </div>
      )}
    </div>
  );
};

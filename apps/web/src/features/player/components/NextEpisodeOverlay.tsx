import React, { useState, useEffect } from 'react';
import { Play, X, FastForward } from 'lucide-react';

interface NextEpisodeOverlayProps {
  nextEpisodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  stillUrl?: string;
  posterUrl?: string;
  overview?: string;
  onPlayNext: () => void;
  onCancel: () => void;
}

export const NextEpisodeOverlay: React.FC<NextEpisodeOverlayProps> = ({
  nextEpisodeTitle,
  seasonNumber,
  episodeNumber,
  stillUrl,
  posterUrl,
  overview,
  onPlayNext,
  onCancel,
}) => {
  const TOTAL_SECONDS = 5;
  const [secondsRemaining, setSecondsRemaining] = useState(TOTAL_SECONDS);

  useEffect(() => {
    if (secondsRemaining <= 0) {
      onPlayNext();
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining, onPlayNext]);

  const progressPercentage = ((TOTAL_SECONDS - secondsRemaining) / TOTAL_SECONDS) * 100;
  const strokeDashoffset = 100 - progressPercentage;

  return (
    <div className="absolute bottom-20 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="w-80 sm:w-96 p-4 bg-zinc-950/90 backdrop-blur-xl border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/80 space-y-3.5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 px-2.5 py-1 bg-brand-600/20 border border-brand-500/30 text-brand-400 text-[11px] font-bold rounded-lg uppercase tracking-wide">
            <FastForward className="w-3 h-3" />
            Sonraki Bölüm
          </span>

          <button
            onClick={onCancel}
            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800/60 rounded-lg transition-colors"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Episode Info & Thumbnail */}
        <div className="flex gap-3">
          <div className="relative w-24 h-16 bg-zinc-900 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-800">
            {stillUrl || posterUrl ? (
              <img
                src={stillUrl || posterUrl}
                alt={nextEpisodeTitle}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                <Play className="w-6 h-6" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-transparent" />
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-[10px] font-bold text-white rounded">
              {seasonNumber}x{episodeNumber < 10 ? `0${episodeNumber}` : episodeNumber}
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <h4 className="text-xs font-bold text-white truncate font-display">
              {nextEpisodeTitle}
            </h4>
            {overview ? (
              <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                {overview}
              </p>
            ) : (
              <p className="text-[11px] text-zinc-400">
                Sezon {seasonNumber} • Bölüm {episodeNumber}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar & Actions */}
        <div className="flex items-center gap-3 pt-1 border-t border-zinc-800/60">
          <button
            onClick={onPlayNext}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-brand-500/20 transition-all active:scale-[0.98]"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Hemen Oynat ({secondsRemaining}s)</span>
          </button>

          {/* Countdown Ring */}
          <div className="relative w-8 h-8 flex items-center justify-center flex-shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-zinc-800"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-brand-500 transition-all duration-1000 ease-linear"
                strokeDasharray="100, 100"
                strokeDashoffset={strokeDashoffset}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="absolute text-[10px] font-bold text-white">
              {secondsRemaining}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

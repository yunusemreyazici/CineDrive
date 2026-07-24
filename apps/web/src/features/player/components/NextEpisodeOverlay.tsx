import React, { useState, useEffect } from 'react';
import { Play, X } from 'lucide-react';

interface NextEpisodeOverlayProps {
  nextEpisodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  onPlayNext: () => void;
  onCancel: () => void;
}

export const NextEpisodeOverlay: React.FC<NextEpisodeOverlayProps> = ({
  nextEpisodeTitle,
  seasonNumber,
  episodeNumber,
  onPlayNext,
  onCancel,
}) => {
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (countdown <= 0) {
      onPlayNext();
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown, onPlayNext]);

  return (
    <div className="absolute inset-0 z-40 bg-zinc-950/85 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="max-w-md w-full p-8 bg-zinc-900/90 border border-zinc-800 rounded-3xl shadow-2xl text-center space-y-6">
        <div>
          <span className="inline-block px-3 py-1 bg-brand-600/20 border border-brand-500/30 text-brand-400 text-xs font-semibold rounded-full mb-3">
            Sonraki Bölüm {countdown}s içinde başlatılıyor
          </span>
          <h3 className="text-xl font-bold font-display text-white">{nextEpisodeTitle}</h3>
          <p className="text-xs text-zinc-400 mt-1">
            Sezon {seasonNumber} • Bölüm {episodeNumber}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onPlayNext}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
          >
            <Play className="w-4 h-4 fill-current" />
            Hemen Oynat ({countdown}s)
          </button>

          <button
            onClick={onCancel}
            className="p-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors"
            aria-label="İptal Et"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

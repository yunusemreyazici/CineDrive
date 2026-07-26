import React from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { t } from '../../../i18n';

interface ResumeOverlayProps {
  savedPositionSeconds: number;
  onResume: () => void;
  onRestart: () => void;
}

export const ResumeOverlay: React.FC<ResumeOverlayProps> = ({
  savedPositionSeconds,
  onResume,
  onRestart,
}) => {
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="absolute inset-0 z-40 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="max-w-md w-full p-8 bg-zinc-900/90 border border-zinc-800 rounded-3xl shadow-2xl text-center space-y-6">
        <div>
          <h3 className="text-xl font-bold font-display text-white mb-2">{t.player.resume.title}</h3>
          <p className="text-xs text-zinc-400">
            {t.player.resume.bodyPrefix}{' '}
            <span className="text-brand-400 font-semibold">{formatTime(savedPositionSeconds)}</span>{' '}
            {t.player.resume.bodySuffix}
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={onResume}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all transform hover:scale-105"
          >
            <Play className="w-4 h-4 fill-current" />
            {t.player.resume.continueAt(formatTime(savedPositionSeconds))}
          </button>

          <button
            onClick={onRestart}
            className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            {t.player.resume.restart}
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { AlertTriangle, RefreshCw, Film } from 'lucide-react';
import type { PlayerErrorState } from '../types/player';
import { t } from '../../../i18n';

interface PlayerErrorProps {
  error: PlayerErrorState;
  onRetry: () => void;
  retryLabel?: string;
  onEnableTranscode?: () => void;
}

export const PlayerError: React.FC<PlayerErrorProps> = ({ error, onRetry, retryLabel, onEnableTranscode }) => {
  const isCodecError = error.code === 'CODEC_NOT_SUPPORTED';

  return (
    <div className="absolute inset-0 z-40 bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-6 text-center text-zinc-100">
      <div className="max-w-md p-8 bg-zinc-900/90 border border-zinc-800 rounded-3xl shadow-2xl space-y-4">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-2">
          {isCodecError ? <Film className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
        </div>

        <h3 className="text-xl font-bold font-display text-white">
          {isCodecError ? t.player.error.codecTitle : t.player.error.genericTitle}
        </h3>

        <p className="text-xs text-zinc-400 leading-relaxed">
          {isCodecError
            ? t.player.error.codecBody
            : error.message || t.player.error.genericBody}
        </p>

        <div className="flex flex-col gap-2 pt-2">
          {onEnableTranscode && (
            <button
              onClick={onEnableTranscode}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              {t.player.error.enableTranscode}
            </button>
          )}

          {error.isRetryable && (
            <button
              onClick={onRetry}
              className="inline-flex items-center justify-center gap-2 px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-xl transition-all"
            >
              {retryLabel || t.player.error.retryDirect}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

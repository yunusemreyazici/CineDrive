import React from 'react';
import { AlertTriangle, RefreshCw, Film } from 'lucide-react';
import type { PlayerErrorState } from '../types/player';

interface PlayerErrorProps {
  error: PlayerErrorState;
  onRetry: () => void;
}

export const PlayerError: React.FC<PlayerErrorProps> = ({ error, onRetry }) => {
  const isCodecError = error.code === 'CODEC_NOT_SUPPORTED';

  return (
    <div className="absolute inset-0 z-40 bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-6 text-center text-zinc-100">
      <div className="max-w-md p-8 bg-zinc-900/90 border border-zinc-800 rounded-3xl shadow-2xl space-y-4">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-2">
          {isCodecError ? <Film className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
        </div>

        <h3 className="text-xl font-bold font-display text-white">
          {isCodecError ? 'Video Biçimi Desteklenmiyor' : 'Oynatma Hatası'}
        </h3>

        <p className="text-xs text-zinc-400 leading-relaxed">
          {isCodecError
            ? 'Bu videonun biçimi tarayıcınız tarafından doğrudan desteklenmiyor. H.264/AAC içeren MP4 biçimine dönüştürmeniz gerekebilir.'
            : error.message || 'Video akışı yüklenirken bir hata oluştu.'}
        </p>

        {error.isRetryable && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all mt-2"
          >
            <RefreshCw className="w-4 h-4" />
            Tekrar Dene
          </button>
        )}
      </div>
    </div>
  );
};

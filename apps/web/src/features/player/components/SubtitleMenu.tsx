import React from 'react';
import { Subtitles, Check } from 'lucide-react';
import type { SubtitleTrackType } from '../types/player';

interface SubtitleMenuProps {
  subtitles: SubtitleTrackType[];
  activeSubtitleId: string | null;
  onSelectSubtitle: (id: string | null) => void;
  onClose: () => void;
}

export const SubtitleMenu: React.FC<SubtitleMenuProps> = ({
  subtitles,
  activeSubtitleId,
  onSelectSubtitle,
  onClose,
}) => {
  return (
    <div className="absolute bottom-16 right-16 w-56 bg-zinc-900/95 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-50 backdrop-blur-xl animate-in fade-in duration-150">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 mb-1 text-xs font-bold text-zinc-400 font-display">
        <Subtitles className="w-4 h-4" />
        Altyazı Seçeneği
      </div>

      <button
        onClick={() => {
          onSelectSubtitle(null);
          onClose();
        }}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-medium transition-colors ${
          activeSubtitleId === null ? 'bg-brand-600/20 text-brand-400' : 'text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <span>Altyazı Kapalı</span>
        {activeSubtitleId === null && <Check className="w-3.5 h-3.5" />}
      </button>

      {subtitles.map((sub) => (
        <button
          key={sub.id}
          onClick={() => {
            onSelectSubtitle(sub.id);
            onClose();
          }}
          className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-medium transition-colors ${
            activeSubtitleId === sub.id ? 'bg-brand-600/20 text-brand-400' : 'text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          <span>{sub.label}</span>
          {activeSubtitleId === sub.id && <Check className="w-3.5 h-3.5" />}
        </button>
      ))}
    </div>
  );
};

import React from 'react';
import { Gauge, Check } from 'lucide-react';

interface PlaybackSpeedMenuProps {
  currentSpeed: number;
  onSelectSpeed: (speed: number) => void;
  onClose: () => void;
}

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export const PlaybackSpeedMenu: React.FC<PlaybackSpeedMenuProps> = ({
  currentSpeed,
  onSelectSpeed,
  onClose,
}) => {
  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] right-3 z-50 w-44 rounded-2xl border border-zinc-800 bg-zinc-900/95 p-2 shadow-2xl backdrop-blur-xl animate-in fade-in duration-150 sm:absolute sm:bottom-16 sm:right-10">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 mb-1 text-xs font-bold text-zinc-400 font-display">
        <Gauge className="w-4 h-4" />
        Oynatma Hızı
      </div>

      {SPEEDS.map((speed) => (
        <button
          key={speed}
          onClick={() => {
            onSelectSpeed(speed);
            onClose();
          }}
          className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-medium transition-colors ${
            currentSpeed === speed
              ? 'bg-brand-600/20 text-brand-400'
              : 'text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          <span>{speed === 1.0 ? 'Normal (1.0x)' : `${speed}x`}</span>
          {currentSpeed === speed && <Check className="w-3.5 h-3.5" />}
        </button>
      ))}
    </div>
  );
};

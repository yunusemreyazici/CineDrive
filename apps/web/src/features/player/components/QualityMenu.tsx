import React from 'react';
import { Check, MonitorUp } from 'lucide-react';

export type QualityPreference = 'auto' | 'original' | '1080p' | '720p' | '480p';

const QUALITIES: Array<{ value: QualityPreference; label: string; detail: string }> = [
  { value: 'auto', label: 'Otomatik', detail: 'Cihaza göre' },
  { value: 'original', label: 'Orijinal', detail: 'En yüksek' },
  { value: '1080p', label: '1080p', detail: '~5 Mbps' },
  { value: '720p', label: '720p', detail: '~3 Mbps' },
  { value: '480p', label: '480p', detail: '~1.5 Mbps' },
];

export const QualityMenu: React.FC<{
  currentQuality: QualityPreference;
  effectiveQuality: Exclude<QualityPreference, 'auto'>;
  onSelectQuality: (quality: QualityPreference) => void;
  onClose: () => void;
}> = ({ currentQuality, effectiveQuality, onSelectQuality, onClose }) => (
  <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] right-3 z-50 w-52 rounded-2xl border border-zinc-800 bg-zinc-900/95 p-2 shadow-2xl backdrop-blur-xl sm:absolute sm:bottom-16 sm:right-10">
    <div className="mb-1 flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs font-bold text-zinc-400">
      <MonitorUp className="h-4 w-4" />
      Görüntü Kalitesi
    </div>
    {QUALITIES.map((quality) => (
      <button
        key={quality.value}
        type="button"
        onClick={() => {
          onSelectQuality(quality.value);
          onClose();
        }}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
          currentQuality === quality.value
            ? 'bg-brand-600/20 text-brand-400'
            : 'text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <span>
          <strong className="block">{quality.label}</strong>
          <span className="text-[10px] text-zinc-500">
            {quality.value === 'auto' ? `Şu an ${effectiveQuality}` : quality.detail}
          </span>
        </span>
        {currentQuality === quality.value ? <Check className="h-3.5 w-3.5" /> : null}
      </button>
    ))}
  </div>
);

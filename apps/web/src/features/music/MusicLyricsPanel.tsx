import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, X } from 'lucide-react';
import { useMusicLyricsQuery } from '../../hooks/useMusicApi';
import { t } from '../../i18n';

interface Props {
  trackId: string;
  position: number;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

export const MusicLyricsPanel: React.FC<Props> = ({ trackId, position, onSeek, onClose }) => {
  const query = useMusicLyricsQuery(trackId);
  const activeRef = useRef<HTMLButtonElement>(null);
  const activeIndex = useMemo(() => {
    if (!query.data?.isSynced) return -1;
    const positionMs = position * 1000;
    let result = -1;
    query.data.lines.forEach((line, index) => {
      if (line.timeMs !== null && line.timeMs <= positionMs) result = index;
    });
    return result;
  }, [position, query.data]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <aside
      aria-label={t.music.lyrics}
      className="fixed bottom-24 right-3 z-[70] flex max-h-[70vh] w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand-400" />
          <h2 className="font-display font-bold">{t.music.lyrics}</h2>
        </div>
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="rounded-lg p-2 hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-48 overflow-y-auto px-5 py-6" aria-live="polite">
        {query.isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-5 animate-pulse rounded bg-white/5" />
            ))}
          </div>
        ) : !query.data || query.data.lines.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <FileText className="mb-3 h-8 w-8 text-zinc-700" />
            <p className="font-medium text-zinc-300">{t.music.noLyrics}</p>
            <p className="mt-1 text-xs text-zinc-600">{t.music.lyricsHint}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {query.data.lines.map((line, index) =>
              query.data?.isSynced && line.timeMs !== null ? (
                <button
                  key={`${line.timeMs}-${index}`}
                  ref={index === activeIndex ? activeRef : undefined}
                  onClick={() => onSeek(line.timeMs! / 1000)}
                  className={`block w-full rounded-lg px-2 py-1 text-left text-lg font-semibold leading-relaxed transition ${index === activeIndex ? 'bg-brand-500/10 text-white' : 'text-zinc-600 hover:text-zinc-300'}`}
                >
                  {line.text || '♪'}
                </button>
              ) : (
                <p key={index} className="text-base leading-8 text-zinc-300">
                  {line.text}
                </p>
              ),
            )}
          </div>
        )}
      </div>
      {query.data && (
        <div className="border-t border-white/5 px-4 py-2 text-[10px] text-zinc-600">
          {query.data.isSynced ? t.music.syncedLyrics : t.music.plainLyrics} ·{' '}
          {query.data.sourceName}
        </div>
      )}
    </aside>
  );
};

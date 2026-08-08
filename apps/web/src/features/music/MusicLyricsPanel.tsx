import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, X } from 'lucide-react';
import { useMusicLyricsQuery } from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { useMusicPlayer } from './MusicPlayerProvider';

interface Props {
  trackId: string;
  position: number;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

export const MusicLyricsPanel: React.FC<Props> = ({ trackId, position, onSeek, onClose }) => {
  const query = useMusicLyricsQuery(trackId);
  const track = useMusicPlayer().currentTrack;
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
      className="fixed inset-0 z-[80] isolate flex flex-col overflow-hidden bg-[#090a0b] shadow-2xl"
    >
      {track?.artworkUrl && (
        <img
          src={track.artworkUrl}
          alt=""
          className="pointer-events-none absolute inset-[-15%] -z-20 h-[130%] w-[130%] scale-110 object-cover opacity-35 blur-[110px] saturate-150"
        />
      )}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/35 via-[#090a0b]/75 to-[#070809]" />
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 backdrop-blur-xl sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-full bg-white/10 p-2">
            <FileText className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold">{t.music.lyrics}</h2>
            <p className="truncate text-xs text-white/45">
              {track?.title} {track?.primaryArtist ? `· ${track.primaryArtist.name}` : ''}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="rounded-full border border-white/10 bg-black/20 p-3 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="mx-auto min-h-48 w-full max-w-4xl flex-1 overflow-y-auto px-6 py-[28vh] sm:px-12"
        aria-live="polite"
      >
        {query.isLoading ? (
          <div className="mx-auto max-w-2xl space-y-6">
            <p className="mb-8 text-center text-sm font-medium text-white/45">
              {t.music.findingLyrics}
            </p>
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-8 animate-pulse rounded-xl bg-white/[0.06]" />
            ))}
          </div>
        ) : !query.data || query.data.lines.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <div className="mb-5 rounded-full border border-white/10 bg-white/[0.04] p-5">
              <FileText className="h-8 w-8 text-white/35" />
            </div>
            <p className="font-display text-xl font-semibold text-white">{t.music.noLyrics}</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/40">{t.music.lyricsHint}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {query.data.lines.map((line, index) =>
              query.data?.isSynced && line.timeMs !== null ? (
                <button
                  key={`${line.timeMs}-${index}`}
                  ref={index === activeIndex ? activeRef : undefined}
                  onClick={() => onSeek(line.timeMs! / 1000)}
                  className={`block w-full rounded-2xl px-4 py-2 text-left font-display text-2xl font-semibold leading-snug transition duration-300 sm:text-4xl sm:leading-tight ${index === activeIndex ? 'translate-x-1 text-white drop-shadow-lg' : 'text-white/25 hover:text-white/55'}`}
                >
                  {line.text || '♪'}
                </button>
              ) : (
                <p
                  key={index}
                  className="font-display text-xl font-medium leading-9 text-white/75 sm:text-3xl sm:leading-[1.45]"
                >
                  {line.text}
                </p>
              ),
            )}
          </div>
        )}
      </div>
      {query.data && (
        <div className="border-t border-white/10 px-5 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 backdrop-blur-xl">
          {query.data.isSynced ? t.music.syncedLyrics : t.music.plainLyrics} ·{' '}
          {query.data.sourceName}
        </div>
      )}
    </aside>
  );
};

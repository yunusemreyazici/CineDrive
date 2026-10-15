import { useEffect, useMemo, useState } from 'react';
import { ListPlus, Search, X } from 'lucide-react';
import { useMusicPlayer } from './MusicPlayerProvider';
import { t } from '../../i18n';

const searchKey = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i');

export function MusicQueuePanel({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const player = useMusicPlayer();
  const [search, setSearch] = useState('');
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [onClose]);
  const visible = useMemo(() => {
    const words = searchKey(search).trim().split(/\s+/).filter(Boolean);
    return player.queue.filter(({ track }) => {
      const text = searchKey(
        [track.title, track.primaryArtist?.name, track.album?.title].filter(Boolean).join(' '),
      );
      return words.every((word) => text.includes(word));
    });
  }, [player.queue, search]);
  const currentIndex = player.queue.findIndex((entry) => entry.id === player.currentQueueItemId);
  const nextId =
    currentIndex >= 0 && player.repeatMode !== 'one'
      ? (
          player.queue[currentIndex + 1] ??
          (player.repeatMode === 'all' ? player.queue[0] : undefined)
        )?.id
      : undefined;

  return (
    <aside
      aria-label={t.music.queue}
      className="fixed bottom-24 right-3 z-[70] flex max-h-[65vh] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <h2 className="font-display font-bold">{t.music.queue}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSave}
            disabled={!player.queue.length}
            aria-label={t.music.saveQueueAsPlaylist}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <ListPlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-lg p-2 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="shrink-0 px-4 py-3">
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-brand-300">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            type="search"
            aria-label={t.music.queueSearch}
            placeholder={t.music.queueSearch}
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 w-full bg-transparent text-sm outline-none"
          />
        </label>
        <p role="status" className="mt-2 text-xs text-zinc-400">
          {t.music.queueMatches(visible.length, player.queue.length)}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto p-2">
        {!visible.length && (
          <p className="px-3 py-6 text-sm text-zinc-400">{t.music.queueNoMatches}</p>
        )}
        {visible.map((item) => {
          const current = item.id === player.currentQueueItemId;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-2 rounded-xl p-2 ${current ? 'bg-brand-500/15 text-brand-300' : 'hover:bg-white/5'}`}
            >
              <button
                type="button"
                onClick={() => player.playQueueItem(item.id)}
                aria-current={current ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                  {item.track.artworkUrl && (
                    <img
                      src={item.track.artworkUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  {(current || item.id === nextId) && (
                    <span className="block text-[10px] font-semibold text-brand-300">
                      {current ? t.music.queueCurrent : t.music.queueUpNext}
                    </span>
                  )}
                  <span className="block truncate text-sm font-medium">{item.track.title}</span>
                  <span className="block truncate text-xs text-zinc-400">
                    {item.track.primaryArtist?.name}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => player.removeFromQueue(item.id)}
                aria-label={t.music.queueRemove(item.track.title)}
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      {player.removedQueueTitle && (
        <div className="flex shrink-0 items-center gap-3 border-t border-white/10 p-3">
          <span role="status" className="min-w-0 flex-1 truncate text-xs text-zinc-400">
            {t.music.queueRemoved(player.removedQueueTitle)}
          </span>
          <button
            type="button"
            onClick={player.undoQueueRemoval}
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-brand-300 hover:bg-white/10"
          >
            {t.music.queueUndo}
          </button>
        </div>
      )}
    </aside>
  );
}

import React, { useState } from 'react';
import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMusicPlayer } from './MusicPlayerProvider';
import { t } from '../../i18n';

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
};

export const MusicPlayerBar: React.FC = () => {
  const player = useMusicPlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  if (!player.currentTrack) return null;
  const track = player.currentTrack;
  return (
    <>
      {queueOpen && (
        <aside className="fixed bottom-24 right-3 z-[70] flex max-h-[65vh] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="font-display font-bold">{t.music.queue}</h2>
            <button
              onClick={() => setQueueOpen(false)}
              aria-label={t.common.close}
              className="rounded-lg p-2 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-2">
            {player.queue.map((item) => (
              <button
                key={item.id}
                onClick={() => player.playQueueItem(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${item.id === player.currentQueueItemId ? 'bg-brand-500/15 text-brand-300' : 'hover:bg-white/5'}`}
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                  {item.track.artworkUrl && (
                    <img
                      src={item.track.artworkUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.track.title}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {item.track.primaryArtist?.name}
                  </span>
                </span>
                <span className="p-0.5">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      player.removeFromQueue(item.id);
                    }}
                    aria-label={t.common.delete}
                    className="p-2 text-zinc-500 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </span>
              </button>
            ))}
          </div>
        </aside>
      )}
      <div className="fixed bottom-0 left-0 right-0 z-[60] border-t border-white/10 bg-[#0b0c0e]/95 px-3 py-2 shadow-2xl backdrop-blur-xl lg:left-[var(--music-sidebar-offset,220px)]">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(260px,2fr)_minmax(160px,1fr)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
              {track.artworkUrl ? (
                <img src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <ListMusic className="m-3 h-6 w-6 text-zinc-600" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{track.title}</p>
              {track.primaryArtist && (
                <Link
                  to={`/music/artists/${track.primaryArtist.id}`}
                  className="block truncate text-xs text-zinc-500 hover:text-brand-400"
                >
                  {track.primaryArtist.name}
                </Link>
              )}
            </div>
          </div>
          <div className="hidden min-w-0 flex-col items-center gap-1 md:flex">
            <div className="flex items-center gap-2">
              <button
                onClick={player.toggleShuffle}
                aria-label={t.music.shuffle}
                className={`p-1.5 ${player.shuffleEnabled ? 'text-brand-400' : 'text-zinc-500'}`}
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                onClick={player.previous}
                aria-label={t.music.previous}
                className="p-1.5 text-zinc-300"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                onClick={player.togglePlay}
                aria-label={player.isPlaying ? t.music.pause : t.music.play}
                className="rounded-full bg-white p-2 text-black"
              >
                {player.isPlaying ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="h-5 w-5 fill-current" />
                )}
              </button>
              <button
                onClick={player.next}
                aria-label={t.music.next}
                className="p-1.5 text-zinc-300"
              >
                <SkipForward className="h-5 w-5" />
              </button>
              <button
                onClick={player.cycleRepeat}
                aria-label={t.music.repeat}
                className={`p-1.5 ${player.repeatMode !== 'off' ? 'text-brand-400' : 'text-zinc-500'}`}
              >
                {player.repeatMode === 'one' ? (
                  <Repeat1 className="h-4 w-4" />
                ) : (
                  <Repeat className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex w-full items-center gap-2 text-[10px] text-zinc-500">
              <span>{formatTime(player.position)}</span>
              <input
                aria-label={t.music.seek}
                type="range"
                min={0}
                max={player.duration || 1}
                step={0.1}
                value={Math.min(player.position, player.duration || 1)}
                onChange={(event) => player.seek(Number(event.target.value))}
                className="h-1 flex-1 accent-brand-500"
              />
              <span>{formatTime(player.duration)}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={player.previous}
              className="p-2 md:hidden"
              aria-label={t.music.previous}
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              onClick={player.togglePlay}
              className="rounded-full bg-white p-2 text-black md:hidden"
              aria-label={player.isPlaying ? t.music.pause : t.music.play}
            >
              {player.isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 fill-current" />
              )}
            </button>
            <button onClick={player.next} className="p-2 md:hidden" aria-label={t.music.next}>
              <SkipForward className="h-4 w-4" />
            </button>
            <Volume2 className="hidden h-4 w-4 text-zinc-500 lg:block" />
            <input
              aria-label={t.music.volume}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={player.volume}
              onChange={(event) => player.setVolume(Number(event.target.value))}
              className="hidden w-24 accent-brand-500 lg:block"
            />
            <button
              onClick={() => setQueueOpen((open) => !open)}
              aria-label={t.music.queue}
              className="p-2 text-zinc-400 hover:text-white"
            >
              <ListMusic className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

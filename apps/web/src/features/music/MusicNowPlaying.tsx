import React, { useState } from 'react';
import {
  ChevronDown,
  FileText,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToggleMusicFavoriteMutation } from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { useMusicPlayer } from './MusicPlayerProvider';

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
};

interface Props {
  onClose: () => void;
  onOpenLyrics: () => void;
  onOpenQueue: () => void;
}

export const MusicNowPlaying: React.FC<Props> = ({ onClose, onOpenLyrics, onOpenQueue }) => {
  const player = useMusicPlayer();
  const favoriteMutation = useToggleMusicFavoriteMutation();
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  const track = player.currentTrack;
  if (!track) return null;
  const isFavorite = favoriteOverrides[track.id] ?? track.isFavorite;

  const toggleFavorite = () => {
    setFavoriteOverrides((items) => ({ ...items, [track.id]: !isFavorite }));
    favoriteMutation.mutate(
      { trackId: track.id, favorite: isFavorite },
      {
        onError: () => setFavoriteOverrides((items) => ({ ...items, [track.id]: isFavorite })),
      },
    );
  };

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={t.music.nowPlaying}
      className="fixed inset-0 z-[90] isolate overflow-y-auto bg-[#08090a] text-white"
    >
      {track.artworkUrl && (
        <img
          src={track.artworkUrl}
          alt=""
          className="pointer-events-none absolute inset-[-12%] -z-20 h-[124%] w-[124%] scale-110 object-cover opacity-45 blur-[90px] saturate-125"
        />
      )}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/25 via-[#090a0c]/60 to-[#070809]" />

      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 pb-8 pt-4 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-full border border-white/10 bg-black/20 p-3 text-zinc-200 backdrop-blur-xl transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/45">
              {t.music.nowPlaying}
            </p>
            <p className="mt-1 max-w-[55vw] truncate text-xs font-semibold text-white/80">
              {track.album?.title || t.music.allTracks}
            </p>
          </div>
          <button
            onClick={onOpenQueue}
            aria-label={t.music.queue}
            className="rounded-full border border-white/10 bg-black/20 p-3 text-zinc-200 backdrop-blur-xl transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ListMusic className="h-5 w-5" />
          </button>
        </header>

        <div className="grid flex-1 items-center gap-8 py-7 md:grid-cols-[minmax(280px,520px)_minmax(280px,1fr)] md:gap-10 md:py-8 lg:gap-16 lg:py-10">
          <div className="mx-auto aspect-square w-full max-w-[min(82vw,48vh,580px)] overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.04] shadow-[0_40px_120px_rgba(0,0,0,.65)] sm:max-w-[min(58vw,50vh,580px)] sm:rounded-[30px] md:max-w-[min(48vw,64vh,520px)] lg:max-w-[min(68vh,580px)]">
            {track.artworkUrl ? (
              <img src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-900 to-zinc-950">
                <ListMusic className="h-24 w-24 text-white/20" />
              </div>
            )}
          </div>

          <div className="mx-auto w-full max-w-xl md:mx-0">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-2xl font-bold tracking-tight sm:text-4xl">
                  {track.title}
                </h1>
                {track.primaryArtist && (
                  <Link
                    to={`/music/artists/${track.primaryArtist.id}`}
                    onClick={onClose}
                    className="mt-2 block truncate text-base font-medium text-white/55 transition hover:text-white sm:text-lg"
                  >
                    {track.primaryArtist.name}
                  </Link>
                )}
              </div>
              <button
                onClick={toggleFavorite}
                aria-label={isFavorite ? t.music.unlike : t.music.like}
                aria-pressed={isFavorite}
                className={`rounded-full border p-3.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  isFavorite
                    ? 'border-brand-400/40 bg-brand-500/20 text-brand-300'
                    : 'border-white/10 bg-white/[0.05] text-white/80 hover:bg-white/10'
                }`}
              >
                <Heart className={`h-6 w-6 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
            </div>

            <div className="mt-8">
              <input
                aria-label={t.music.seek}
                type="range"
                min={0}
                max={player.duration || 1}
                step={0.1}
                value={Math.min(player.position, player.duration || 1)}
                onChange={(event) => player.seek(Number(event.target.value))}
                className="music-range w-full"
              />
              <div className="mt-2 flex justify-between text-xs font-medium tabular-nums text-white/45">
                <span>{formatTime(player.position)}</span>
                <span>-{formatTime(Math.max(0, player.duration - player.position))}</span>
              </div>
            </div>

            <div className="mt-7 flex items-center justify-between sm:mt-9">
              <button
                onClick={player.toggleShuffle}
                aria-label={t.music.shuffle}
                aria-pressed={player.shuffleEnabled}
                className={
                  player.shuffleEnabled ? 'text-brand-300' : 'text-white/45 hover:text-white'
                }
              >
                <Shuffle className="h-5 w-5" />
              </button>
              <button onClick={player.previous} aria-label={t.music.previous} className="p-2">
                <SkipBack className="h-8 w-8 fill-current" />
              </button>
              <button
                onClick={player.togglePlay}
                aria-label={player.isPlaying ? t.music.pause : t.music.play}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-2xl transition hover:scale-105 active:scale-95 sm:h-20 sm:w-20"
              >
                {player.isPlaying ? (
                  <Pause className="h-8 w-8 fill-current sm:h-9 sm:w-9" />
                ) : (
                  <Play className="ml-1 h-8 w-8 fill-current sm:h-9 sm:w-9" />
                )}
              </button>
              <button onClick={player.next} aria-label={t.music.next} className="p-2">
                <SkipForward className="h-8 w-8 fill-current" />
              </button>
              <button
                onClick={player.cycleRepeat}
                aria-label={t.music.repeat}
                className={
                  player.repeatMode !== 'off' ? 'text-brand-300' : 'text-white/45 hover:text-white'
                }
              >
                {player.repeatMode === 'one' ? (
                  <Repeat1 className="h-5 w-5" />
                ) : (
                  <Repeat className="h-5 w-5" />
                )}
              </button>
            </div>

            <div className="mt-9 flex items-center gap-3 border-t border-white/10 pt-5">
              <button
                onClick={onOpenLyrics}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold backdrop-blur transition hover:bg-white/10"
              >
                <FileText className="h-4 w-4" />
                {t.music.lyrics}
              </button>
              <Volume2 className="hidden h-4 w-4 text-white/40 sm:block" />
              <input
                aria-label={t.music.volume}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.volume}
                onChange={(event) => player.setVolume(Number(event.target.value))}
                className="music-range hidden w-28 sm:block"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

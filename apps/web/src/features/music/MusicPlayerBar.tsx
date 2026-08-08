import React, { useState } from 'react';
import {
  ChevronUp,
  FileText,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMusicPlayer } from './MusicPlayerProvider';
import { t } from '../../i18n';
import { MusicLyricsPanel } from './MusicLyricsPanel';
import { MusicNowPlaying } from './MusicNowPlaying';
import { MusicAudioSettingsPanel } from './MusicAudioSettingsPanel';
import { audioQualityTier, formatAudioQuality } from './musicAudio';
import { useArtworkPalette } from './useArtworkPalette';

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
};

export const MusicPlayerBar: React.FC = () => {
  const player = useMusicPlayer();
  const [drawer, setDrawer] = useState<'queue' | 'lyrics' | 'nowPlaying' | 'audio' | null>(null);
  const [audioReturnDrawer, setAudioReturnDrawer] = useState<'nowPlaying' | null>(null);
  const palette = useArtworkPalette(player.currentTrack?.artworkUrl);
  if (!player.currentTrack) return null;
  const track = player.currentTrack;
  const quality = formatAudioQuality(track);
  const qualityTier = audioQualityTier(track);
  return (
    <>
      {drawer === 'audio' && (
        <MusicAudioSettingsPanel
          onClose={() => {
            setDrawer(audioReturnDrawer);
            setAudioReturnDrawer(null);
          }}
        />
      )}
      {drawer === 'lyrics' && (
        <MusicLyricsPanel
          trackId={track.id}
          position={player.position}
          onSeek={player.seek}
          onClose={() => setDrawer(null)}
        />
      )}
      {(drawer === 'nowPlaying' || (drawer === 'audio' && audioReturnDrawer === 'nowPlaying')) && (
        <MusicNowPlaying
          onClose={() => setDrawer(null)}
          onOpenLyrics={() => setDrawer('lyrics')}
          onOpenQueue={() => setDrawer('queue')}
          onOpenAudioSettings={() => {
            setAudioReturnDrawer('nowPlaying');
            setDrawer('audio');
          }}
        />
      )}
      {drawer === 'queue' && (
        <aside className="fixed bottom-24 right-3 z-[70] flex max-h-[65vh] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/98 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="font-display font-bold">{t.music.queue}</h2>
            <button
              onClick={() => setDrawer(null)}
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
      {drawer !== 'nowPlaying' && !(drawer === 'audio' && audioReturnDrawer === 'nowPlaying') && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] isolate overflow-hidden border-t border-white/10 bg-[#0a0b0d]/90 px-3 py-2.5 shadow-[0_-20px_60px_rgba(0,0,0,.35)] backdrop-blur-2xl lg:left-[var(--music-sidebar-offset,220px)]">
          {track.artworkUrl && (
            <img
              src={track.artworkUrl}
              alt=""
              className="pointer-events-none absolute inset-0 -z-20 h-full w-full scale-125 object-cover opacity-15 blur-3xl saturate-150"
            />
          )}
          <div
            className="pointer-events-none absolute inset-0 -z-20"
            style={{
              backgroundImage: `linear-gradient(100deg, rgb(${palette.primary} / .32), transparent 42%, rgb(${palette.secondary} / .18))`,
            }}
          />
          <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-black/75 via-[#0a0b0d]/85 to-black/75" />
          <div className="mx-auto grid max-w-[1600px] grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-[minmax(210px,1fr)_minmax(300px,2fr)_minmax(190px,1fr)]">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setDrawer('nowPlaying')}
                aria-label={t.music.openNowPlaying}
                className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-800 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white md:h-14 md:w-14"
              >
                {track.artworkUrl ? (
                  <img
                    src={track.artworkUrl}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <ListMusic className="m-3 h-6 w-6 text-zinc-600" />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <ChevronUp className="h-5 w-5" />
                </span>
              </button>
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
                {quality && (
                  <p className="mt-0.5 hidden truncate text-[10px] font-semibold uppercase tracking-wide text-white/35 xl:block">
                    {qualityTier === 'hi_res'
                      ? `${t.music.hiRes} · `
                      : qualityTier === 'lossless'
                        ? `${t.music.lossless} · `
                        : ''}
                    {quality}
                  </p>
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
                  className="music-range flex-1"
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
                className="music-range hidden w-24 lg:block"
              />
              <button
                onClick={() => {
                  if (drawer === 'audio') {
                    setDrawer(null);
                    setAudioReturnDrawer(null);
                  } else {
                    setAudioReturnDrawer(null);
                    setDrawer('audio');
                  }
                }}
                aria-label={t.music.audioSettings}
                aria-pressed={drawer === 'audio'}
                className={`hidden p-2 hover:text-white sm:block ${drawer === 'audio' ? 'text-cyan-300' : 'text-zinc-400'}`}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </button>
              <button
                onClick={() => setDrawer((open) => (open === 'lyrics' ? null : 'lyrics'))}
                aria-label={t.music.lyrics}
                aria-pressed={drawer === 'lyrics'}
                className={`p-2 hover:text-white ${drawer === 'lyrics' ? 'text-brand-400' : 'text-zinc-400'}`}
              >
                <FileText className="h-5 w-5" />
              </button>
              <button
                onClick={() => setDrawer((open) => (open === 'queue' ? null : 'queue'))}
                aria-label={t.music.queue}
                aria-pressed={drawer === 'queue'}
                className={`p-2 hover:text-white ${drawer === 'queue' ? 'text-brand-400' : 'text-zinc-400'}`}
              >
                <ListMusic className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

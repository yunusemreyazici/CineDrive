import React, { useState } from 'react';
import {
  ChevronUp,
  FileText,
  Infinity as InfinityIcon,
  ListMusic,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMusicPlayer } from './MusicPlayerProvider';
import { t } from '../../i18n';
import { MusicLyricsPanel } from './MusicLyricsPanel';
import { MusicNowPlaying } from './MusicNowPlaying';
import { MusicAudioSettingsPanel } from './MusicAudioSettingsPanel';
import { audioQualityTier, formatAudioQuality } from './musicAudio';
import { useArtworkPalette } from './useArtworkPalette';
import { Modal } from '../../components/common/Modal';
import { useCreateMusicPlaylistFromTracksMutation } from '../../hooks/useMusicApi';
import { toast } from '../../stores/useToastStore';
import { MusicSleepTimerButton } from './MusicSleepTimerButton';
import { MusicQueuePanel } from './MusicQueuePanel';

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
  const [saveQueueOpen, setSaveQueueOpen] = useState(false);
  const [queuePlaylistName, setQueuePlaylistName] = useState(t.music.defaultQueuePlaylistName);
  const createPlaylist = useCreateMusicPlaylistFromTracksMutation();
  const palette = useArtworkPalette(player.currentTrack?.artworkUrl);
  const track = player.currentTrack;
  const quality = track ? formatAudioQuality(track) : '';
  const qualityTier = track ? audioQualityTier(track) : null;
  const saveQueue = async () => {
    const name = queuePlaylistName.trim();
    if (!name || !player.queue.length) return;
    try {
      await createPlaylist.mutateAsync({
        name,
        trackIds: player.queue.map((item) => item.trackId),
      });
      toast.success(t.music.queueSavedAsPlaylist);
      setSaveQueueOpen(false);
      setQueuePlaylistName(t.music.defaultQueuePlaylistName);
    } catch (error) {
      toast.fromError(error);
    }
  };
  return (
    <>
      <Modal
        isOpen={saveQueueOpen}
        onClose={() => !createPlaylist.isPending && setSaveQueueOpen(false)}
        title={t.music.saveQueueAsPlaylist}
        description={t.music.saveQueueHint}
        icon={<ListPlus className="h-5 w-5 text-brand-300" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSaveQueueOpen(false)}
              disabled={createPlaylist.isPending}
              className="rounded-xl px-4 py-2 text-sm font-medium text-white/55 hover:bg-white/5"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void saveQueue()}
              disabled={!queuePlaylistName.trim() || createPlaylist.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-bold text-black disabled:opacity-40"
            >
              {createPlaylist.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.common.save}
            </button>
          </div>
        }
      >
        <div className="p-6">
          <label className="block text-sm font-medium text-white/65">
            {t.music.playlistName}
            <input
              value={queuePlaylistName}
              onChange={(event) => setQueuePlaylistName(event.target.value)}
              maxLength={120}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-white outline-none focus:border-brand-300/50"
            />
          </label>
        </div>
      </Modal>
      {drawer === 'audio' && (
        <MusicAudioSettingsPanel
          onClose={() => {
            setDrawer(audioReturnDrawer);
            setAudioReturnDrawer(null);
          }}
        />
      )}
      {track && drawer === 'lyrics' && (
        <MusicLyricsPanel
          trackId={track.id}
          position={player.position}
          onSeek={player.seek}
          onClose={() => setDrawer(null)}
        />
      )}
      {track &&
        (drawer === 'nowPlaying' || (drawer === 'audio' && audioReturnDrawer === 'nowPlaying')) && (
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
        <MusicQueuePanel
          onClose={() => setDrawer(null)}
          onSave={() => {
            setDrawer(null);
            setSaveQueueOpen(true);
          }}
        />
      )}
      {track &&
        drawer !== 'nowPlaying' &&
        !(drawer === 'audio' && audioReturnDrawer === 'nowPlaying') && (
          <div className="cd-player-dock fixed bottom-3 left-3 right-3 z-[60] isolate overflow-hidden px-3 py-3 backdrop-blur-xl lg:left-[calc(var(--app-sidebar-offset,240px)+16px)] lg:right-4">
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
            <div className="pointer-events-none absolute inset-0 -z-10 bg-zinc-900/80" />
            <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,1.2fr)_auto]">
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
                    type="button"
                    onClick={player.toggleShuffle}
                    aria-label={t.music.shuffle}
                    aria-pressed={player.shuffleEnabled}
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
                  <button
                    type="button"
                    onClick={player.toggleContinuousPlay}
                    aria-label={t.music.continuousPlay}
                    aria-pressed={player.continuousPlayEnabled}
                    title={t.music.continuousPlay}
                    className={`p-1.5 ${player.continuousPlayEnabled ? 'text-emerald-300' : 'text-zinc-500'}`}
                  >
                    <InfinityIcon className="h-4 w-4" />
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
                <MusicSleepTimerButton compact />
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

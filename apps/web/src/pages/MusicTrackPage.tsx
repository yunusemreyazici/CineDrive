import React, { useState } from 'react';
import { Info, Music2, Play } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ErrorState } from '../components/common/ErrorState';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import { MusicTrackInfoPanel } from '../features/music/MusicTrackInfoPanel';
import { formatAudioQuality } from '../features/music/musicAudio';
import { useArtworkPalette } from '../features/music/useArtworkPalette';
import { useMusicTrackQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

const MusicTrackContent: React.FC<{ trackId: string }> = ({ trackId }) => {
  const query = useMusicTrackQuery(trackId);
  const player = useMusicPlayer();
  const [showsInfo, setShowsInfo] = useState(false);
  const track = query.data;
  const palette = useArtworkPalette(track?.artworkUrl);

  if (query.isError && !track) {
    return (
      <ErrorState
        error={query.error}
        title={t.music.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (!track) return <div className="h-[28rem] animate-pulse rounded-3xl bg-zinc-900" />;

  const artist = track.primaryArtist || track.artists[0];
  const quality = formatAudioQuality(track);

  return (
    <>
      <main className="relative isolate -mx-4 -mt-4 min-h-[calc(100vh-5rem)] overflow-hidden px-4 pb-36 pt-12 sm:-mx-6 sm:px-8 sm:pt-20 lg:-mx-8 lg:px-12">
        <div
          className="pointer-events-none absolute inset-0 -z-20"
          style={{
            background: `radial-gradient(circle at 28% 25%, rgb(${palette.primary} / .58), transparent 42%), radial-gradient(circle at 78% 72%, rgb(${palette.secondary} / .3), transparent 46%), #08090b`,
          }}
        />
        {track.artworkUrl && (
          <img
            src={track.artworkUrl}
            alt=""
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-20 blur-[80px] saturate-150"
          />
        )}
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 sm:flex-row sm:items-end sm:gap-10">
          <div className="flex aspect-square w-full max-w-[20rem] shrink-0 items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 bg-black/25 shadow-[0_30px_90px_rgba(0,0,0,.65)] sm:w-[42%]">
            {track.artworkUrl ? (
              <img src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Music2 className="h-24 w-24 text-white/20" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1 text-center sm:pb-3 sm:text-left">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white/50">
              {t.music.track}
            </p>
            <h1 className="mt-3 break-words text-balance font-display text-4xl font-black tracking-tight sm:text-6xl">
              {track.title}
            </h1>
            <div className="mt-4 text-lg font-semibold text-white/65">
              {artist ? (
                <Link className="transition hover:text-white" to={`/music/artists/${artist.id}`}>
                  {artist.name}
                </Link>
              ) : (
                '—'
              )}
              {track.album && (
                <>
                  <span aria-hidden="true"> · </span>
                  <Link
                    className="transition hover:text-white"
                    to={`/music/albums/${track.album.id}`}
                  >
                    {track.album.title}
                  </Link>
                </>
              )}
            </div>
            {quality && <p className="mt-3 text-sm text-white/40">{quality}</p>}

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <button
                type="button"
                onClick={() => player.playTracks([track])}
                aria-label={t.music.playTrack(track.title)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-bold text-black shadow-xl transition hover:scale-[1.03]"
              >
                <Play className="h-5 w-5 fill-current" aria-hidden="true" />
                {t.music.play}
              </button>
              <button
                type="button"
                onClick={() => setShowsInfo(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-6 py-3.5 font-bold text-white backdrop-blur transition hover:bg-white/10"
              >
                <Info className="h-5 w-5" aria-hidden="true" />
                {t.music.trackInfo}
              </button>
            </div>
          </div>
        </div>
      </main>

      {showsInfo && (
        <MusicTrackInfoPanel
          trackId={track.id}
          fallbackTrack={track}
          onClose={() => setShowsInfo(false)}
        />
      )}
    </>
  );
};

export const MusicTrackPage: React.FC = () => {
  const { trackId } = useParams<{ trackId: string }>();

  if (!trackId) return <Navigate to="/music/tracks" replace />;

  return <MusicTrackContent trackId={trackId} />;
};

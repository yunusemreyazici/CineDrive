import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Info, Heart, Video, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { useToggleFavoriteMutation } from '../../hooks/useApi';
import { TrailerModal } from './TrailerModal';
import { extractYoutubeId } from '../../utils/youtube';
import { formatMediaTitle } from '../../utils/formatMediaTitle';
import { getHeroArtworkUrl } from '../../utils/mediaImages';
import { t } from '../../i18n';
import type { MediaItemType } from '../../types/media';

interface FeaturedHeroProps {
  media: MediaItemType;
}

const AUTOPLAY_DELAY_MS = 2500;

function isDirectVideoUrl(url?: string | null) {
  return Boolean(url && /\.(?:mp4|webm|m3u8)(?:$|[?#])/i.test(url));
}

interface HeroTrailerProps {
  title: string;
  trailerUrl?: string | null;
  onPlayingChange: (playing: boolean) => void;
}

const HeroTrailer: React.FC<HeroTrailerProps> = ({ title, trailerUrl, onPlayingChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const youtubeId = extractYoutubeId(trailerUrl);
  const directVideo = isDirectVideoUrl(trailerUrl);

  useEffect(() => {
    setEnabled(false);
    setReady(false);
    setMuted(true);
    onPlayingChange(false);

    if (!trailerUrl || (!youtubeId && !directVideo)) return;

    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean };
      }
    ).connection;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (connection?.saveData || reduceMotion) return;

    const timer = window.setTimeout(() => setEnabled(true), AUTOPLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [directVideo, onPlayingChange, trailerUrl, youtubeId]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        videoRef.current?.pause();
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
          '*',
        );
      } else if (enabled) {
        void videoRef.current?.play().catch(() => undefined);
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
          '*',
        );
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled]);

  if (!enabled || (!youtubeId && !directVideo)) return null;

  const sendYoutubeCommand = (func: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }),
      '*',
    );
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (videoRef.current) videoRef.current.muted = nextMuted;
    if (youtubeId) sendYoutubeCommand(nextMuted ? 'mute' : 'unMute');
  };

  const restart = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => undefined);
    }
    if (youtubeId) {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }),
        '*',
      );
      sendYoutubeCommand('playVideo');
    }
  };

  return (
    <>
      {directVideo ? (
        <video
          ref={videoRef}
          src={trailerUrl ?? undefined}
          aria-label={t.hero.trailerLabel(title)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}
          autoPlay
          muted
          playsInline
          preload="metadata"
          onCanPlay={() => {
            setReady(true);
            onPlayingChange(true);
          }}
          onEnded={() => onPlayingChange(false)}
          onError={() => onPlayingChange(false)}
        />
      ) : (
        <iframe
          ref={iframeRef}
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&loop=1&playlist=${youtubeId}&modestbranding=1&playsinline=1&rel=0&enablejsapi=1`}
          title={t.hero.trailerLabel(title)}
          className={`pointer-events-none absolute left-1/2 top-1/2 h-[56.25vw] min-h-full w-[177.78vh] min-w-full -translate-x-1/2 -translate-y-1/2 transition-opacity duration-700 ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}
          allow="autoplay; encrypted-media"
          onLoad={() => {
            setReady(true);
            onPlayingChange(true);
          }}
        />
      )}

      {ready && (
        <div className="absolute bottom-6 right-6 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={restart}
            aria-label={t.hero.replayTrailer}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/70"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? t.hero.unmuteTrailer : t.hero.muteTrailer}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/70"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      )}
    </>
  );
};

export const FeaturedHero: React.FC<FeaturedHeroProps> = ({ media }) => {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();
  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);

  const backdropUrl = getHeroArtworkUrl(media);

  return (
    <section className="relative flex h-[420px] w-full items-center overflow-hidden bg-[#070809] md:h-[460px]">
      {backdropUrl ? (
        <img
          src={backdropUrl}
          alt=""
          // This is the largest element on the home page and therefore what
          // LCP measures. Without the hint the browser ranks it behind the
          // card posters it discovers at the same time.
          fetchPriority="high"
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${
            trailerPlaying ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-950 via-zinc-950 to-zinc-900" />
      )}

      <HeroTrailer
        title={media.title}
        trailerUrl={media.trailerUrl}
        onPlayingChange={setTrailerPlaying}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#070809] via-transparent to-black/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#070809] via-[#070809]/75 to-transparent md:via-[#070809]/50" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-l from-[#070809]/45 via-transparent to-transparent" />

      <div className="relative z-10 w-full max-w-[500px] px-5 md:px-8 lg:px-10">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.035em] text-white drop-shadow-md md:text-5xl">
          {formatMediaTitle(media.title)}
        </h1>

        <div className="mt-3 flex items-center gap-2.5 text-xs font-medium text-zinc-300">
          {media.year && <span>{media.year}</span>}
          {media.year && <span className="h-1 w-1 rounded-full bg-brand-500" />}
          <span>{media.type === 'movie' ? 'Film' : 'Dizi'}</span>
          {'duration' in media && typeof media.duration === 'number' && (
            <>
              <span className="h-1 w-1 rounded-full bg-zinc-600" />
              <span>{Math.max(1, Math.round(media.duration / 60))} dk</span>
            </>
          )}
        </div>

        {media.overview && (
          <p className="mt-5 line-clamp-3 max-w-[500px] text-sm leading-6 text-zinc-300 drop-shadow">
            {media.overview}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => navigate(`/watch/${media.id}`)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-950/30 transition hover:bg-brand-500 active:scale-[0.98]"
          >
            <Play className="h-4 w-4 fill-current" />
            {media.progress && media.progress.percentage > 0
              ? t.mediaDetail.resume
              : t.mediaDetail.play}
          </button>

          {media.trailerUrl && (
            <button
              onClick={() => setShowTrailerModal(true)}
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/10"
            >
              <Video className="h-4 w-4 text-brand-400" />
              Fragman
            </button>
          )}

          <button
            onClick={() => navigate(`/media/${media.id}`)}
            className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/10"
          >
            <Info className="h-4 w-4" />
            Detaylar
          </button>

          <button
            onClick={() =>
              toggleFavorite.mutate({
                mediaItemId: media.id,
                isFavorite: !!media.isFavorite,
              })
            }
            aria-label={t.hero.toggleFavorite}
            className={`flex h-10 w-10 items-center justify-center rounded-lg border backdrop-blur-md transition ${
              media.isFavorite
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-500'
                : 'border-white/15 bg-black/35 text-zinc-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Heart className={`h-4 w-4 ${media.isFavorite ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      <TrailerModal
        isOpen={showTrailerModal}
        onClose={() => setShowTrailerModal(false)}
        title={media.title}
        trailerUrl={media.trailerUrl}
      />
    </section>
  );
};

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Info, Heart, Video } from 'lucide-react';
import { useToggleFavoriteMutation } from '../../hooks/useApi';
import { TrailerModal } from './TrailerModal';

interface FeaturedHeroProps {
  media: {
    id: string;
    type: 'movie' | 'series';
    title: string;
    overview?: string;
    year?: number;
    trailerUrl?: string | null;
    backdropDriveFileId?: string;
    posterDriveFileId?: string;
    isFavorite?: boolean;
    progress?: {
      percentage: number;
    } | null;
  };
}

export const FeaturedHero: React.FC<FeaturedHeroProps> = ({ media }) => {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();
  const [showTrailerModal, setShowTrailerModal] = useState(false);

  const backdropUrl =
    (media as { backdropUrl?: string; posterUrl?: string }).backdropUrl ||
    (media as { backdropUrl?: string; posterUrl?: string }).posterUrl ||
    (media.backdropDriveFileId
      ? `/api/media/assets/${media.backdropDriveFileId}`
      : media.posterDriveFileId
        ? `/api/media/assets/${media.posterDriveFileId}`
        : null);

  return (
    <section className="relative flex min-h-[430px] w-full items-end overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900 shadow-[0_32px_90px_rgba(0,0,0,0.38)] md:min-h-[520px]">
      {backdropUrl ? (
        <img
          src={backdropUrl}
          alt={media.title}
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-950 via-zinc-950 to-zinc-900" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/30 to-black/5" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/65 to-transparent md:via-zinc-950/35" />

      <div className="relative z-10 max-w-2xl p-6 md:p-10 lg:p-12">
        <h1 className="max-w-xl font-display text-4xl font-extrabold tracking-[-0.035em] text-white drop-shadow-md md:text-6xl">
          {media.title}
        </h1>

        <div className="mt-4 flex items-center gap-2.5 text-xs font-medium text-zinc-300 md:text-sm">
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
          <p className="mt-5 line-clamp-3 max-w-xl text-sm leading-6 text-zinc-300 drop-shadow md:text-base md:leading-7">
            {media.overview}
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            onClick={() => navigate(`/watch/${media.id}`)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-950/30 transition hover:bg-brand-500 active:scale-[0.98]"
          >
            <Play className="h-4 w-4 fill-current" />
            {media.progress && media.progress.percentage > 0 ? 'Kaldığın Yerden Devam Et' : 'Oynat'}
          </button>

          {media.trailerUrl && (
            <button
              onClick={() => setShowTrailerModal(true)}
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-4 py-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/10"
            >
              <Video className="h-4 w-4 text-brand-400" />
              Fragman
            </button>
          )}

          <button
            onClick={() => navigate(`/media/${media.id}`)}
            className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-4 py-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/10"
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
            aria-label="Favoriye Ekle/Çıkar"
            className={`flex h-11 w-11 items-center justify-center rounded-lg border backdrop-blur-md transition ${
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

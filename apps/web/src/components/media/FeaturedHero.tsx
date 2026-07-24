import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Info, Heart, Sparkles } from 'lucide-react';
import { useToggleFavoriteMutation } from '../../hooks/useApi';

interface FeaturedHeroProps {
  media: {
    id: string;
    type: 'movie' | 'series';
    title: string;
    overview?: string;
    year?: number;
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

  const backdropUrl =
    (media as { backdropUrl?: string; posterUrl?: string }).backdropUrl ||
    (media as { backdropUrl?: string; posterUrl?: string }).posterUrl ||
    (media.backdropDriveFileId
      ? `/api/media/assets/${media.backdropDriveFileId}`
      : media.posterDriveFileId
        ? `/api/media/assets/${media.posterDriveFileId}`
        : null);

  return (
    <div className="relative w-full rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800/80 mb-10 shadow-2xl min-h-[380px] md:min-h-[460px] flex items-end">
      {/* Background Image / Blur Gradient Overlay */}
      {backdropUrl ? (
        <img
          src={backdropUrl}
          alt={media.title}
          className="absolute inset-0 w-full h-full object-cover object-center scale-105 filter brightness-75"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-950 via-zinc-950 to-zinc-900" />
      )}

      {/* Hero Content Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/40 to-transparent" />

      {/* Content Body */}
      <div className="relative z-10 p-6 md:p-10 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-600/30 border border-brand-500/40 text-brand-300 text-xs font-semibold backdrop-blur-md mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          Öne Çıkan Medya
        </div>

        <h2 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight font-display drop-shadow-md mb-2">
          {media.title}
        </h2>

        <div className="flex items-center gap-3 text-xs md:text-sm text-zinc-300 font-medium mb-4">
          <span className="px-2.5 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-700 uppercase">
            {media.type === 'movie' ? 'Film' : 'Dizi'}
          </span>
          {media.year && <span>{media.year}</span>}
        </div>

        {media.overview && (
          <p className="text-sm md:text-base text-zinc-300 line-clamp-3 mb-6 leading-relaxed drop-shadow">
            {media.overview}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => navigate(`/watch/${media.id}`)}
            className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-brand-500/25 transition-all transform hover:scale-105 active:scale-95"
          >
            <Play className="w-5 h-5 fill-current" />
            {media.progress && media.progress.percentage > 0 ? 'Kaldığın Yerden Devam Et' : 'Oynat'}
          </button>

          <button
            onClick={() => navigate(`/media/${media.id}`)}
            className="flex items-center gap-2 px-5 py-3 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 text-white font-medium text-sm rounded-xl backdrop-blur-md transition-all hover:scale-105"
          >
            <Info className="w-5 h-5" />
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
            className={`p-3 rounded-xl border backdrop-blur-md transition-all hover:scale-105 ${
              media.isFavorite
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-500'
                : 'bg-zinc-900/80 border-zinc-700 text-zinc-400 hover:text-white'
            }`}
          >
            <Heart className={`w-5 h-5 ${media.isFavorite ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

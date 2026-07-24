import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Heart, Film, Tv, Info } from 'lucide-react';
import { useToggleFavoriteMutation } from '../../hooks/useApi';

interface MediaCardProps {
  media: {
    id: string;
    type: 'movie' | 'series';
    title: string;
    year?: number;
    posterDriveFileId?: string;
    isFavorite?: boolean;
    progress?: {
      percentage: number;
    } | null;
  };
  layout?: 'grid' | 'list';
}

export const MediaCard: React.FC<MediaCardProps> = ({ media, layout = 'grid' }) => {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();

  const posterUrl =
    (media as { posterUrl?: string }).posterUrl ||
    (media.posterDriveFileId ? `/api/media/assets/${media.posterDriveFileId}` : null);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFavorite.mutate({
      mediaItemId: media.id,
      isFavorite: !!media.isFavorite,
    });
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigate(`/watch/${media.id}`);
  };

  if (layout === 'list') {
    return (
      <div
        onClick={() => navigate(`/media/${media.id}`)}
        className="group flex items-center gap-4 p-3 bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/50 hover:border-brand-500/40 rounded-2xl cursor-pointer transition-all duration-200"
      >
        <div className="relative w-16 aspect-[2/3] bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={media.title}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              <Film className="w-6 h-6" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-base font-semibold text-zinc-100 group-hover:text-brand-400 transition-colors truncate">
            {media.title}
          </h4>
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-medium capitalize">
              {media.type === 'movie' ? 'Film' : 'Dizi'}
            </span>
            {media.year && <span>{media.year}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleFavoriteClick}
            aria-label={media.isFavorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
            className={`p-2.5 rounded-xl border transition-colors ${
              media.isFavorite
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:text-white'
            }`}
          >
            <Heart className={`w-4 h-4 ${media.isFavorite ? 'fill-current' : ''}`} />
          </button>
          <button
            onClick={handlePlayClick}
            aria-label="Oynat"
            className="p-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl shadow-md transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => navigate(`/media/${media.id}`)}
      className="group relative flex flex-col bg-zinc-900/40 border border-zinc-800/50 hover:border-brand-500/40 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-brand-500/5 hover:-translate-y-1"
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full bg-zinc-900 overflow-hidden">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={media.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-zinc-700 p-4 text-center">
            {media.type === 'movie' ? <Film className="w-12 h-12 mb-2" /> : <Tv className="w-12 h-12 mb-2" />}
            <span className="text-xs text-zinc-500 font-medium line-clamp-2">{media.title}</span>
          </div>
        )}

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
          <span className="px-2.5 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md border border-zinc-800 text-[10px] font-bold text-zinc-200 uppercase tracking-wider">
            {media.type === 'movie' ? 'Film' : 'Dizi'}
          </span>
          <button
            onClick={handleFavoriteClick}
            aria-label={media.isFavorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
            className={`pointer-events-auto p-2 rounded-full backdrop-blur-md border transition-all ${
              media.isFavorite
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-500'
                : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${media.isFavorite ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Hover Overlay Actions */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-3 p-4">
          <button
            onClick={handlePlayClick}
            aria-label="Hızlı Oynat"
            className="p-3 bg-brand-600 hover:bg-brand-500 text-white rounded-full shadow-lg shadow-brand-500/30 transform scale-90 group-hover:scale-100 transition-all duration-300"
          >
            <Play className="w-5 h-5 fill-current translate-x-0.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/media/${media.id}`);
            }}
            aria-label="Detay"
            className="p-3 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 text-white rounded-full backdrop-blur-md transform scale-90 group-hover:scale-100 transition-all duration-300"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>

        {/* Watch progress bar if in-progress */}
        {media.progress && media.progress.percentage > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${Math.min(100, media.progress.percentage)}%` }}
            />
          </div>
        )}
      </div>

      {/* Info Container */}
      <div className="p-3.5">
        <h4 className="text-sm font-semibold text-zinc-100 group-hover:text-brand-400 transition-colors line-clamp-1">
          {media.title}
        </h4>
        {media.year && <p className="text-xs text-zinc-500 mt-1 font-medium">{media.year}</p>}
      </div>
    </div>
  );
};

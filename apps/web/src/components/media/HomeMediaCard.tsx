import React from 'react';
import { Heart, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToggleFavoriteMutation } from '../../hooks/useApi';
import type { MediaItemType } from '../../types/media';

interface HomeMediaCardProps {
  media: MediaItemType;
}

export const HomeMediaCard: React.FC<HomeMediaCardProps> = ({ media }) => {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();
  const imageUrl =
    media.backdropUrl ||
    media.posterUrl ||
    (media.backdropDriveFileId
      ? `/api/media/assets/${media.backdropDriveFileId}`
      : media.posterDriveFileId
        ? `/api/media/assets/${media.posterDriveFileId}`
        : null);

  const handleFavorite = (event: React.MouseEvent) => {
    event.stopPropagation();
    toggleFavorite.mutate({
      mediaItemId: media.id,
      isFavorite: Boolean(media.isFavorite),
    });
  };

  return (
    <article
      className="group min-w-0 cursor-pointer"
      onClick={() => navigate(`/media/${media.id}`)}
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900 shadow-[0_16px_40px_rgba(0,0,0,0.22)] transition duration-300 group-hover:-translate-y-1 group-hover:border-brand-500/45 group-hover:shadow-[0_20px_48px_rgba(0,0,0,0.38)]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={media.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 px-5 text-center text-sm font-semibold text-zinc-500">
            {media.title}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-80" />

        <button
          type="button"
          aria-label={`${media.title} oynat`}
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/watch/${media.id}`);
          }}
          className="absolute bottom-3 left-3 flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-brand-600 text-white opacity-0 shadow-lg shadow-black/30 transition duration-200 hover:bg-brand-500 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
        >
          <Play className="h-4 w-4 translate-x-px fill-current" />
        </button>

        <button
          type="button"
          aria-label={media.isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          onClick={handleFavorite}
          className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition ${
            media.isFavorite
              ? 'border-brand-400/50 bg-brand-600 text-white'
              : 'border-white/10 bg-black/45 text-zinc-300 opacity-0 hover:text-white group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          <Heart className={`h-3.5 w-3.5 ${media.isFavorite ? 'fill-current' : ''}`} />
        </button>

        {media.progress && media.progress.percentage > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
            <div
              className="h-full bg-brand-500"
              style={{ width: `${Math.min(100, media.progress.percentage)}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="pt-3">
        <h3 className="truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
          {media.title}
        </h3>
        <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
          <span>{media.type === 'movie' ? 'Film' : 'Dizi'}</span>
          {media.year ? (
            <>
              <span className="h-0.5 w-0.5 rounded-full bg-zinc-600" />
              <span>{media.year}</span>
            </>
          ) : null}
        </p>
      </div>
    </article>
  );
};

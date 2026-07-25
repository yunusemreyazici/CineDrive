import React from 'react';
import { Heart, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToggleFavoriteMutation } from '../../hooks/useApi';
import type { MediaItemType } from '../../types/media';
import { formatMediaTitle } from '../../utils/formatMediaTitle';

interface HomeMediaCardProps {
  media: MediaItemType;
}

export const HomeMediaCard: React.FC<HomeMediaCardProps> = ({ media }) => {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();
  const imageUrl =
    media.posterUrl ||
    (media.posterDriveFileId
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
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111214] shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition duration-300 group-hover:scale-[1.02] group-hover:bg-[#181a1d] group-hover:shadow-[0_18px_42px_rgba(0,0,0,0.32)]">
        <div className="relative aspect-[2/3] overflow-hidden bg-zinc-900">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={media.title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-800/80 via-zinc-900 to-black px-5 text-center text-sm font-semibold text-zinc-400">
              <Play className="h-8 w-8 text-zinc-600" />
              {formatMediaTitle(media.title)}
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />

        <button
          type="button"
          aria-label={`${media.title} oynat`}
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/watch/${media.id}`);
          }}
          className="absolute bottom-2.5 right-2.5 flex h-8 w-8 translate-y-2 items-center justify-center rounded-full border border-white/35 bg-black/60 text-white opacity-0 shadow-lg shadow-black/30 backdrop-blur transition duration-200 hover:border-brand-400 hover:bg-brand-600 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
        >
          <Play className="h-4 w-4 translate-x-px fill-current" />
        </button>

        <button
          type="button"
          aria-label={media.isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          onClick={handleFavorite}
          className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md transition ${
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

        <div className="px-3 py-2.5">
          <h3 className="truncate text-xs font-semibold text-zinc-100 transition-colors group-hover:text-white md:text-sm">
            {formatMediaTitle(media.title)}
          </h3>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
            {media.year ? <span>{media.year}</span> : null}
            {media.year ? <span className="h-0.5 w-0.5 rounded-full bg-zinc-600" /> : null}
            <span>{media.type === 'movie' ? 'Film' : 'Dizi'}</span>
          </p>
        </div>
      </div>
    </article>
  );
};

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Heart, Film, Tv, Info } from 'lucide-react';
import { useToggleFavoriteMutation } from '../../hooks/useApi';
import type { MediaItemType } from '../../types/media';
import { getPosterUrl } from '../../utils/mediaImages';
import { t } from '../../i18n';

interface MediaCardProps {
  media: MediaItemType;
  layout?: 'grid' | 'list';
}

export const MediaCard: React.FC<MediaCardProps> = ({ media, layout = 'grid' }) => {
  const navigate = useNavigate();
  const toggleFavorite = useToggleFavoriteMutation();

  const posterUrl = getPosterUrl(media);
  const typeLabel = media.type === 'movie' ? t.common.movie : t.common.series;

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

  // The whole card navigates, but it also holds its own buttons. Nesting those
  // inside an <a> would be invalid, so the link is stretched over the card and
  // the buttons are lifted above it.
  const stretchedLink = (
    <Link
      to={`/media/${media.id}`}
      className="absolute inset-0 z-10 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
    >
      <span className="sr-only">
        {t.mediaCard.openDetails(media.title)}
      </span>
    </Link>
  );

  if (layout === 'list') {
    return (
      <article className="group relative flex items-center gap-4 rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-3 transition-all duration-200 hover:border-brand-500/40 hover:bg-zinc-900">
        {stretchedLink}

        <div className="relative aspect-[2/3] w-16 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-600">
              <Film className="h-6 w-6" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="truncate text-base font-semibold text-zinc-100 transition-colors group-hover:text-brand-400">
            {media.title}
          </h4>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-medium capitalize text-zinc-300">
              {typeLabel}
            </span>
            {media.year && <span>{media.year}</span>}
          </div>
        </div>

        <div className="relative z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleFavoriteClick}
            aria-label={
              media.isFavorite
                ? t.mediaCard.removeFavorite(media.title)
                : t.mediaCard.addFavorite(media.title)
            }
            aria-pressed={!!media.isFavorite}
            className={`rounded-xl border p-2.5 transition-colors ${
              media.isFavorite
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-500'
                : 'border-zinc-700/40 bg-zinc-800/60 text-zinc-400 hover:text-white'
            }`}
          >
            <Heart className={`h-4 w-4 ${media.isFavorite ? 'fill-current' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label={t.mediaCard.play(media.title)}
            className="rounded-xl bg-brand-600 p-2.5 text-white shadow-md transition-colors hover:bg-brand-500"
          >
            <Play className="h-4 w-4 fill-current" />
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-900/40 transition-all duration-300 hover:-translate-y-1 hover:border-brand-500/40 hover:shadow-xl hover:shadow-brand-500/5">
      {stretchedLink}

      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-zinc-900">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 text-center text-zinc-700">
            {media.type === 'movie' ? (
              <Film className="mb-2 h-12 w-12" />
            ) : (
              <Tv className="mb-2 h-12 w-12" />
            )}
            <span className="line-clamp-2 text-xs font-medium text-zinc-500">{media.title}</span>
          </div>
        )}

        {/* Top Badges */}
        <div className="pointer-events-none absolute left-3 right-3 top-3 flex items-center justify-between">
          <span className="rounded-full border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-200 backdrop-blur-md">
            {typeLabel}
          </span>
          <button
            type="button"
            onClick={handleFavoriteClick}
            aria-label={
              media.isFavorite
                ? t.mediaCard.removeFavorite(media.title)
                : t.mediaCard.addFavorite(media.title)
            }
            aria-pressed={!!media.isFavorite}
            className={`pointer-events-auto relative z-20 rounded-full border p-2 backdrop-blur-md transition-all ${
              media.isFavorite
                ? 'border-rose-500/40 bg-rose-500/20 text-rose-500'
                : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:bg-zinc-900 hover:text-white'
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${media.isFavorite ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Hover Overlay Actions */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label={t.mediaCard.play(media.title)}
            className="pointer-events-auto relative z-20 scale-90 transform rounded-full bg-brand-600 p-3 text-white shadow-lg shadow-brand-500/30 transition-all duration-300 hover:bg-brand-500 group-hover:scale-100"
          >
            <Play className="h-5 w-5 translate-x-0.5 fill-current" />
          </button>
          <Link
            to={`/media/${media.id}`}
            aria-label={t.mediaCard.details(media.title)}
            className="pointer-events-auto relative z-20 scale-90 transform rounded-full border border-zinc-700 bg-zinc-900/80 p-3 text-white backdrop-blur-md transition-all duration-300 hover:bg-zinc-800 group-hover:scale-100"
          >
            <Info className="h-5 w-5" />
          </Link>
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
        <h4 className="line-clamp-1 text-sm font-semibold text-zinc-100 transition-colors group-hover:text-brand-400">
          {media.title}
        </h4>
        {media.year && <p className="mt-1 text-xs font-medium text-zinc-500">{media.year}</p>}
      </div>
    </article>
  );
};

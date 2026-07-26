import React from 'react';
import { Heart } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useFavoritesQuery } from '../hooks/useApi';
import { t } from '../i18n';

export const FavoritesPage: React.FC = () => {
  const { data: favorites, isLoading, isError, error, refetch } = useFavoritesQuery();

  return (
    <div className="space-y-6">
      {/* Same header shape as the library and the other collection pages. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">
          {t.favorites.title}
        </h2>
        {favorites && favorites.length > 0 && (
          <span className="text-sm text-zinc-500">{t.library.itemCount(favorites.length)}</span>
        )}
        <p className="w-full text-sm text-zinc-400">{t.favorites.subtitle}</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title={t.favorites.loadFailed} onRetry={() => void refetch()} />
      ) : !favorites || favorites.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t.favorites.emptyTitle}
          description={t.favorites.emptyDescription}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {favorites.map((media) => (
            <MediaCard key={media.id} media={media} />
          ))}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { Heart } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { useFavoritesQuery } from '../hooks/useApi';

export const FavoritesPage: React.FC = () => {
  const { data: favorites, isLoading } = useFavoritesQuery();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl">
          <Heart className="w-6 h-6 fill-current" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">Favorilerim</h2>
          <p className="text-sm text-zinc-400 mt-0.5">Beğendiğiniz ve favorilere eklediğiniz medya içerikleri</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : !favorites || favorites.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Favoriniz Bulunmuyor"
          description="Beğendiğiniz filmleri ve dizileri kalbe tıklayarak favorilerinize ekleyebilirsiniz."
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

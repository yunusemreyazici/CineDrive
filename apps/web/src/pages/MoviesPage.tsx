import React from 'react';
import { Film } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { useMediaListQuery } from '../hooks/useApi';

export const MoviesPage: React.FC = () => {
  const { data, isLoading } = useMediaListQuery({ type: 'movie', limit: 30 });

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
        <div className="p-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-2xl">
          <Film className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">Filmler</h2>
          <p className="text-sm text-zinc-400 mt-0.5">Google Drive arşivinizdeki tüm sinema filmleri</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : !data || data.media.length === 0 ? (
        <EmptyState
          icon={Film}
          title="Film Bulunamadı"
          description="Kütüphanenizde henüz kayıtlı bir film bulunmuyor."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {data.media.map((media) => (
            <MediaCard key={media.id} media={media} />
          ))}
        </div>
      )}
    </div>
  );
};

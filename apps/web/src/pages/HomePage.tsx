import React from 'react';
import { Play, Film, Tv, Heart, History } from 'lucide-react';
import { FeaturedHero } from '../components/media/FeaturedHero';
import { MediaCard } from '../components/media/MediaCard';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import {
  useMediaListQuery,
  useContinueWatchingQuery,
  useFavoritesQuery,
} from '../hooks/useApi';
import type { MediaItemType } from '../types/media';

export const HomePage: React.FC = () => {
  const { data: mediaData, isLoading: isMediaLoading } = useMediaListQuery({ limit: 30 });
  const { data: continueWatching } = useContinueWatchingQuery();
  const { data: favorites } = useFavoritesQuery();

  const allMedia = mediaData?.media || [];
  const featuredItem = allMedia[0];
  const movies = allMedia.filter((m) => m.type === 'movie');
  const series = allMedia.filter((m) => m.type === 'series');

  if (isMediaLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="w-full h-96 bg-zinc-900 rounded-3xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (allMedia.length === 0) {
    return (
      <EmptyState
        title="Medya Arşivi Boş"
        description="Google Drive kütüphaneniz henüz taranmamış veya medya dosyası bulunamamış. Lütfen Ayarlar sayfasından kütüphane taramasını başlatın."
        actionLabel="Ayarlara Git"
        onAction={() => (window.location.href = '/settings')}
      />
    );
  }

  return (
    <div className="space-y-12">
      {/* Featured Hero */}
      {featuredItem && <FeaturedHero media={featuredItem} />}

      {/* Continue Watching Section */}
      {continueWatching && continueWatching.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-brand-600/20 text-brand-400 rounded-xl">
              <Play className="w-5 h-5 fill-current" />
            </div>
            <h3 className="text-xl font-bold font-display text-white">İzlemeye Devam Et</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {continueWatching.map((item) => (
              <MediaCard key={item.id} media={(item.mediaItem || item) as MediaItemType} />
            ))}
          </div>
        </section>
      )}

      {/* Recently Added Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <History className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold font-display text-white">Son Eklenenler</h3>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {allMedia.slice(0, 6).map((media) => (
            <MediaCard key={media.id} media={media} />
          ))}
        </div>
      </section>

      {/* Movies Section */}
      {movies.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-500/10 text-purple-400 rounded-xl">
              <Film className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold font-display text-white">Filmler</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {movies.slice(0, 6).map((media) => (
              <MediaCard key={media.id} media={media} />
            ))}
          </div>
        </section>
      )}

      {/* Series Section */}
      {series.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <Tv className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold font-display text-white">Diziler</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {series.slice(0, 6).map((media) => (
              <MediaCard key={media.id} media={media} />
            ))}
          </div>
        </section>
      )}

      {/* Favorites Section */}
      {favorites && favorites.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
              <Heart className="w-5 h-5 fill-current" />
            </div>
            <h3 className="text-xl font-bold font-display text-white">Favorileriniz</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {favorites.slice(0, 6).map((media) => (
              <MediaCard key={media.id} media={media} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

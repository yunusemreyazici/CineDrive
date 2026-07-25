import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FeaturedHero } from '../components/media/FeaturedHero';
import { HomeMediaCard } from '../components/media/HomeMediaCard';
import { ContinueWatchingCard } from '../components/media/ContinueWatchingCard';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import type { MediaItemType } from '../types/media';
import {
  useMediaListQuery,
  useContinueWatchingQuery,
  useFavoritesQuery,
} from '../hooks/useApi';

interface HomeSectionProps {
  title: string;
  href: string;
  items: MediaItemType[];
}

const HomeSection: React.FC<HomeSectionProps> = ({ title, href, items }) => {
  if (items.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-white md:text-2xl">
            {title}
          </h2>
          <div className="mt-2 h-px w-10 bg-brand-500" />
        </div>
        <Link
          to={href}
          className="group/link flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition hover:text-brand-400"
        >
          Tümünü gör
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-6">
        {items.slice(0, 6).map((media) => (
          <HomeMediaCard key={media.id} media={media} />
        ))}
      </div>
    </section>
  );
};

export const HomePage: React.FC = () => {
  const { data: mediaData, isLoading: isMediaLoading } = useMediaListQuery({ limit: 30 });
  const { data: continueWatching } = useContinueWatchingQuery();
  const { data: favorites } = useFavoritesQuery();

  const allMedia = mediaData?.media || [];
  const featuredItem =
    allMedia.find(
      (media) =>
        Boolean(media.backdropUrl || media.backdropDriveFileId) &&
        Boolean(media.overview),
    ) ||
    allMedia.find((media) => Boolean(media.backdropUrl || media.backdropDriveFileId)) ||
    allMedia[0];
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
    <div className="space-y-14 pb-10 md:space-y-16">
      {featuredItem && <FeaturedHero media={featuredItem} />}

      {continueWatching && continueWatching.length > 0 && (
        <section className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight text-white md:text-2xl">
                İzlemeye Devam Et
              </h2>
              <div className="mt-2 h-px w-10 bg-brand-500" />
            </div>
            <Link
              to="/history"
              className="group/link flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition hover:text-brand-400"
            >
              Geçmişi aç
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {continueWatching.slice(0, 4).map((item) => (
              <ContinueWatchingCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      <HomeSection title="Son Eklenenler" href="/library" items={allMedia} />
      <HomeSection title="Filmler" href="/movies" items={movies} />
      <HomeSection title="Diziler" href="/series" items={series} />
      <HomeSection title="Favorileriniz" href="/favorites" items={favorites || []} />
    </div>
  );
};

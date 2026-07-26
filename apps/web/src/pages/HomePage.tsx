import React, { useLayoutEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { FeaturedHero } from '../components/media/FeaturedHero';
import { HomeMediaCard } from '../components/media/HomeMediaCard';
import { ContinueWatchingCard } from '../components/media/ContinueWatchingCard';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { t } from '../i18n';
import type { MediaItemType } from '../types/media';
import {
  useMediaListQuery,
  useContinueWatchingQuery,
} from '../hooks/useApi';

const LAST_FEATURED_MEDIA_KEY = 'cinedrive-last-featured-media-v1';

interface HomeSectionProps {
  title: string;
  href: string;
  items: MediaItemType[];
  layout?: 'grid' | 'rail';
}

const HomeSection: React.FC<HomeSectionProps> = ({ title, href, items, layout = 'rail' }) => {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-lg font-bold tracking-tight text-white md:text-xl">
          {title}
        </h2>
        <Link
          to={href}
          className="group/link flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition hover:text-brand-400"
        >
          {t.common.seeAll}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
        </Link>
      </div>
      {layout === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.slice(0, 6).map((media) => (
            <HomeMediaCard key={media.id} media={media} />
          ))}
        </div>
      ) : (
        <div className="scrollbar-none flex snap-x gap-3 overflow-x-auto pb-2">
          {items.slice(0, 12).map((media) => (
            <div key={media.id} className="w-[150px] shrink-0 snap-start sm:w-[170px] xl:w-[185px]">
              <HomeMediaCard media={media} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const {
    data: mediaData,
    isLoading: isMediaLoading,
    isError: isMediaError,
    error: mediaError,
    refetch: refetchMedia,
  } = useMediaListQuery({ limit: 30 });
  // Ask the server for each rail separately. Filtering a single "latest 30"
  // page client-side left the movie or series rail empty whenever recent
  // additions happened to be all one type.
  const { data: movieData } = useMediaListQuery({ type: 'movie', limit: 12 });
  const { data: seriesData } = useMediaListQuery({ type: 'series', limit: 12 });
  const { data: continueWatching } = useContinueWatchingQuery();

  const allMedia = useMemo(() => mediaData?.media || [], [mediaData]);
  const movies = movieData?.media || [];
  const series = seriesData?.media || [];
  const featuredCandidates = useMemo(() => {
    const moviesOnly = allMedia.filter((media) => media.type === 'movie');
    const candidatePool = moviesOnly.length > 0 ? moviesOnly : allMedia;
    const richCandidates = candidatePool.filter(
      (media) =>
        Boolean(media.backdropUrl || media.backdropDriveFileId) &&
        Boolean(media.overview),
    );
    const visualCandidates = candidatePool.filter((media) =>
      Boolean(media.backdropUrl || media.backdropDriveFileId),
    );

    return (
      richCandidates.length > 0
        ? richCandidates
        : visualCandidates.length > 0
          ? visualCandidates
          : candidatePool
    );
  }, [allMedia]);
  const featuredItem =
    featuredCandidates.find((media) => media.id === featuredId) || featuredCandidates[0];
  const genres = useMemo(
    () => Array.from(new Set(allMedia.flatMap((media) => media.genres || []))).slice(0, 10),
    [allMedia],
  );

  useLayoutEffect(() => {
    if (featuredId || allMedia.length === 0) return;

    const candidates = featuredCandidates;

    let lastFeaturedId: string | null = null;
    try {
      lastFeaturedId = window.sessionStorage.getItem(LAST_FEATURED_MEDIA_KEY);
    } catch {
      // Random selection still works when storage access is blocked.
    }

    const freshCandidates =
      candidates.length > 1
        ? candidates.filter((media) => media.id !== lastFeaturedId)
        : candidates;
    const selected =
      freshCandidates[Math.floor(Math.random() * freshCandidates.length)] || candidates[0];
    if (!selected) return;

    setFeaturedId(selected.id);
    try {
      window.sessionStorage.setItem(LAST_FEATURED_MEDIA_KEY, selected.id);
    } catch {
      // Persisting the pick is best-effort.
    }
  }, [allMedia.length, featuredCandidates, featuredId]);

  if (isMediaLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-[350px] w-full rounded-2xl bg-zinc-900" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (isMediaError) {
    return (
      <ErrorState
        error={mediaError}
        title={t.home.loadFailed}
        onRetry={() => void refetchMedia()}
      />
    );
  }

  if (allMedia.length === 0) {
    return (
      <EmptyState
        title={t.home.emptyTitle}
        description={t.home.emptyDescription}
        actionLabel={t.home.emptyAction}
        onAction={() => navigate('/settings')}
      />
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {featuredItem && (
        <FeaturedHero media={featuredItem} />
      )}

      {continueWatching && continueWatching.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-bold tracking-tight text-white md:text-xl">
              {t.home.continueWatching}
            </h2>
            <Link
              to="/history"
              className="group/link flex items-center gap-1.5 text-xs font-semibold text-zinc-500 transition hover:text-brand-400"
            >
              {t.common.seeAll}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/link:translate-x-0.5" />
            </Link>
          </div>
          <div className="scrollbar-none flex snap-x gap-3 overflow-x-auto pb-2">
            {continueWatching.slice(0, 10).map((item) => (
              <ContinueWatchingCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      <HomeSection title={t.home.recentlyAdded} href="/library" items={allMedia} layout="grid" />
      <HomeSection title={t.common.movies} href="/movies" items={movies} />
      <HomeSection title={t.common.seriesPlural} href="/series" items={series} />

      {genres.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold tracking-tight text-white md:text-xl">
            {t.home.byGenre}
          </h2>
          <div className="flex flex-wrap gap-2">
            {genres.map((genre) => (
              <Link
                key={genre}
                to={`/library?genre=${encodeURIComponent(genre)}`}
                className="rounded-lg border border-white/[0.08] bg-[#111214] px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-[#181a1d] hover:text-white"
              >
                {genre}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

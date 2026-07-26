import React, { useState, useMemo } from 'react';
import { Tv } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { FilterPanel, type FilterState } from '../components/media/FilterPanel';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useMediaListQuery } from '../hooks/useApi';
import { t } from '../i18n';

export const SeriesPage: React.FC = () => {
  const [filterState, setFilterState] = useState<FilterState>({
    sortBy: 'createdAt',
    sortOrder: 'desc',
    minRating: undefined,
    yearRange: 'all',
    genre: undefined,
  });

  const queryInput = useMemo(() => {
    let yearFrom: number | undefined;
    let yearTo: number | undefined;

    if (filterState.yearRange === '2020s') yearFrom = 2020;
    else if (filterState.yearRange === '2010s') {
      yearFrom = 2010;
      yearTo = 2019;
    } else if (filterState.yearRange === '2000s') {
      yearFrom = 2000;
      yearTo = 2009;
    } else if (filterState.yearRange === 'classics') {
      yearTo = 1999;
    }

    return {
      type: 'series' as const,
      genre: filterState.genre,
      minRating: filterState.minRating,
      yearFrom,
      yearTo,
      sortBy: filterState.sortBy,
      sortOrder: filterState.sortOrder,
      limit: 100,
    };
  }, [filterState]);

  const { data, isLoading, isError, error, refetch } = useMediaListQuery(queryInput);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl">
          <Tv className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">{t.series.title}</h2>
          <p className="text-sm text-zinc-400 mt-0.5">{t.series.subtitle}</p>
        </div>
      </div>

      <FilterPanel
        filters={filterState}
        onChange={setFilterState}
        totalResults={data?.pagination.total}
      />

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title={t.series.loadFailed} onRetry={() => void refetch()} />
      ) : !data || data.media.length === 0 ? (
        <EmptyState
          icon={Tv}
          title={t.series.notFoundTitle}
          description={t.series.notFoundDescription}
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

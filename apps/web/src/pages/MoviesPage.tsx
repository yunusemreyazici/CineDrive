import React, { useState, useMemo } from 'react';
import { Film } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { FilterPanel } from '../components/media/FilterPanel';
import { DEFAULT_FILTERS, type FilterState } from '../components/media/filterState';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useMediaListQuery } from '../hooks/useApi';
import { t } from '../i18n';

export const MoviesPage: React.FC = () => {
  const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTERS);

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
      type: 'movie' as const,
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
      {/* Same header shape as the library, which is what this page is a
          pre-filtered view of. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">
          {t.movies.title}
        </h2>
        {data && (
          <span className="text-sm text-zinc-500">
            {t.library.itemCount(data.pagination.total)}
          </span>
        )}
        <p className="w-full text-sm text-zinc-400">{t.movies.subtitle}</p>
      </div>

      <FilterPanel filters={filterState} onChange={setFilterState} />

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title={t.movies.loadFailed} onRetry={() => void refetch()} />
      ) : !data || data.media.length === 0 ? (
        <EmptyState
          icon={Film}
          title={t.movies.notFoundTitle}
          description={t.movies.notFoundDescription}
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

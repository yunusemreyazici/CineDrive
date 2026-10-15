import React, { useEffect } from 'react';
import { Tv } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { FilterPanel } from '../components/media/FilterPanel';
import { SavedBrowseViews } from '../components/media/SavedBrowseViews';
import { useMediaBrowseState } from '../hooks/useMediaBrowseState';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useMediaListQuery } from '../hooks/useApi';
import { t } from '../i18n';
import { MediaPagination } from '../components/common/MediaPagination';
import { useCatalogueLayout } from '../hooks/useCatalogueLayout';
import { CatalogueLayoutControls } from '../components/media/CatalogueLayoutControls';

export const SeriesPage: React.FC = () => {
  const layout = useCatalogueLayout();
  const {
    filters: filterState,
    setFilters: setFilterState,
    page,
    setPage,
    queryInput,
  } = useMediaBrowseState('series');

  const { data, isLoading, isError, error, refetch } = useMediaListQuery(queryInput);

  useEffect(() => {
    if (!data || page <= Math.max(1, data.pagination.totalPages)) return;
    const timer = window.setTimeout(() => setPage(Math.max(1, data.pagination.totalPages)), 0);
    return () => window.clearTimeout(timer);
  }, [data, page, setPage]);

  return (
    <div className="space-y-8">
      {/* Same header shape as the library, which is what this page is a
          pre-filtered view of. */}
      <div className="cd-page-heading">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">
          {t.series.title}
        </h2>
        {data && (
          <span className="text-sm text-zinc-500">
            {t.library.itemCount(data.pagination.total)}
          </span>
        )}
        <p className="w-full text-sm text-zinc-400">{t.series.subtitle}</p>
      </div>

      <CatalogueLayoutControls layout={layout} />
      <SavedBrowseViews />
      <FilterPanel filters={filterState} onChange={setFilterState} />

      {isLoading ? (
        <div className={layout.gridClassName}>
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
        <div className={layout.mode === 'grid' ? layout.gridClassName : 'space-y-3'}>
          {data.media.map((media) => (
            <MediaCard key={media.id} media={media} layout={layout.mode} />
          ))}
        </div>
      )}

      {data && (
        <MediaPagination
          page={page}
          totalPages={data.pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
};

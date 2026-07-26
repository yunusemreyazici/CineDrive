import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutGrid, List, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { FilterPanel, type FilterState } from '../components/media/FilterPanel';
import { SkeletonCard } from '../components/common/SkeletonCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useUiStore } from '../stores/useUiStore';
import { useMediaListQuery } from '../hooks/useApi';
import { useSyncedState } from '../hooks/useSyncedState';
import { t } from '../i18n';

const SEARCH_DEBOUNCE_MS = 300;

export const LibraryPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { viewMode, setViewMode } = useUiStore();

  const typeParam = searchParams.get('type') as 'movie' | 'series' | null;
  const searchParam = searchParams.get('search') || '';
  const genreParam = searchParams.get('genre') || undefined;
  const pageParam = parseInt(searchParams.get('page') || '1', 10);

  // The input stays responsive on every keystroke while the URL — and with it
  // the media query — only follows once typing settles.
  const [searchDraft, setSearchDraft] = useSyncedState(searchParam);

  React.useEffect(() => {
    if (searchDraft === searchParam) return;

    const timer = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          if (searchDraft) prev.set('search', searchDraft);
          else prev.delete('search');
          prev.set('page', '1');
          return prev;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [searchDraft, searchParam, setSearchParams]);

  const [filterState, setFilterState] = useState<FilterState>({
    sortBy: 'createdAt',
    sortOrder: 'desc',
    minRating: undefined,
    yearRange: 'all',
    genre: genreParam,
  });

  // The genre can arrive from a link (?genre=Dram) or from the filter panel, so
  // the URL value is folded into the filter state during render rather than in
  // an effect that would render the stale genre once first.
  const [lastGenreParam, setLastGenreParam] = useState(genreParam);
  if (genreParam !== lastGenreParam) {
    setLastGenreParam(genreParam);
    setFilterState((current) => ({ ...current, genre: genreParam }));
  }

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
      type: typeParam || undefined,
      search: searchParam || undefined,
      genre: filterState.genre,
      minRating: filterState.minRating,
      yearFrom,
      yearTo,
      sortBy: filterState.sortBy,
      sortOrder: filterState.sortOrder,
      page: pageParam,
      limit: 18,
    };
  }, [typeParam, searchParam, filterState, pageParam]);

  const { data, isLoading, isError, error, refetch } = useMediaListQuery(queryInput);

  const handleTypeChange = (newType: string) => {
    setSearchParams((prev) => {
      if (newType === 'all') prev.delete('type');
      else prev.set('type', newType);
      prev.set('page', '1');
      return prev;
    });
  };

  const handlePageChange = (newPage: number) => {
    setSearchParams((prev) => {
      prev.set('page', newPage.toString());
      return prev;
    });
  };

  return (
    <div className="space-y-8">
      {/* Header & Filter Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800/60">
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">{t.library.title}</h2>
          <p className="text-sm text-zinc-400 mt-1">{t.library.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
            <button
              onClick={() => setViewMode('grid')}
              aria-label={t.library.gridView}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              aria-label={t.library.listView}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'list' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* Type Filter Buttons */}
          <div className="flex items-center p-1 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-medium">
            <button
              onClick={() => handleTypeChange('all')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                !typeParam ? 'bg-brand-600 text-white font-semibold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.common.all}
            </button>
            <button
              onClick={() => handleTypeChange('movie')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                typeParam === 'movie' ? 'bg-brand-600 text-white font-semibold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.common.movies}
            </button>
            <button
              onClick={() => handleTypeChange('series')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                typeParam === 'series' ? 'bg-brand-600 text-white font-semibold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.common.seriesPlural}
            </button>
          </div>

        </div>
      </div>

      {/* Filter Search Input */}
      <div className="relative max-w-lg">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          aria-label={t.library.searchLabel}
          placeholder={t.library.searchPlaceholder}
          className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/60 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      {/* Filter Panel */}
      <FilterPanel
        filters={filterState}
        onChange={setFilterState}
        totalResults={data?.pagination.total}
      />

      {/* Media Grid / List */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title={t.library.loadFailed} onRetry={() => void refetch()} />
      ) : !data || data.media.length === 0 ? (
        <EmptyState
          title={t.library.notFoundTitle}
          description={t.library.notFoundDescription}
          actionLabel={t.library.clearFilters}
          onAction={() => setSearchParams(new URLSearchParams())}
        />
      ) : (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4'
              : 'space-y-3'
          }
        >
          {data.media.map((media) => (
            <MediaCard key={media.id} media={media} layout={viewMode} />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-8">
          <button
            onClick={() => handlePageChange(pageParam - 1)}
            disabled={pageParam <= 1}
            className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm text-zinc-400 font-medium font-display">
            {t.library.page} <span className="text-white font-bold">{pageParam}</span> / {data.pagination.totalPages}
          </span>
          <button
            onClick={() => handlePageChange(pageParam + 1)}
            disabled={pageParam >= data.pagination.totalPages}
            className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-300 hover:text-white disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};

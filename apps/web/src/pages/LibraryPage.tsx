import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutGrid, List, Search, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { MediaCard } from '../components/media/MediaCard';
import { FilterPanel } from '../components/media/FilterPanel';
import {
  DEFAULT_FILTERS,
  activeFilters,
  type FilterState,
} from '../components/media/filterState';
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
    ...DEFAULT_FILTERS,
    genre: genreParam,
  });
  const [showFilters, setShowFilters] = useState(false);

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

  const currentFilters = activeFilters(filterState);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">
          {t.library.title}
        </h2>
        {data && (
          <span className="text-sm text-zinc-500">
            {t.library.itemCount(data.pagination.total)}
          </span>
        )}
        <p className="w-full text-sm text-zinc-400">{t.library.subtitle}</p>
      </div>

      {/*
        One row instead of three. Search, type, view mode and the filter
        disclosure used to occupy three stacked bands, so on a laptop the first
        poster started below the fold.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            aria-label={t.library.searchLabel}
            placeholder={t.library.searchPlaceholder}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
          />
        </div>

        <div className="flex rounded-lg border border-zinc-800 p-0.5 text-xs font-medium">
          {[
            { id: 'all', label: t.common.all },
            { id: 'movie', label: t.common.movies },
            { id: 'series', label: t.common.seriesPlural },
          ].map((option) => {
            const isActive = (typeParam || 'all') === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleTypeChange(option.id)}
                className={`rounded-md px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex rounded-lg border border-zinc-800 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label={t.library.gridView}
            aria-pressed={viewMode === 'grid'}
            className={`rounded-md p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              viewMode === 'grid' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label={t.library.listView}
            aria-pressed={viewMode === 'list'}
            className={`rounded-md p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              viewMode === 'list' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((open) => !open)}
          aria-expanded={showFilters}
          aria-label={t.filters.toggleLabel}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            showFilters || currentFilters.length > 0
              ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
              : 'border-zinc-800 text-zinc-400 hover:text-zinc-100'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {t.filters.toggle}
          {currentFilters.length > 0 && (
            <span className="rounded bg-brand-500/20 px-1.5 text-[11px]">
              {currentFilters.length}
            </span>
          )}
        </button>
      </div>

      {showFilters && <FilterPanel filters={filterState} onChange={setFilterState} />}

      {/* Collapsed filters must still be visible as state, not just as a count. */}
      {currentFilters.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {currentFilters.map((filter) => (
            <li key={filter.key}>
              <button
                type="button"
                onClick={() => setFilterState(filter.clear(filterState))}
                aria-label={t.filters.clearOne(filter.label)}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 py-1 pl-3 pr-2 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {filter.label}
                <X className="h-3 w-3 text-zinc-500" />
              </button>
            </li>
          ))}
        </ul>
      )}

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

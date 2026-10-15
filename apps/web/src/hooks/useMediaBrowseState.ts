import { useSearchParams } from 'react-router-dom';
import { useCallback, useRef } from 'react';
import {
  readBrowseState,
  writeBrowseFilters,
  browseYearBounds,
} from '../components/media/browseState';
import { DEFAULT_FILTERS, type FilterState } from '../components/media/filterState';

export function useMediaBrowseState(fixedType?: 'movie' | 'series') {
  const [params, navigateParams] = useSearchParams();
  // Router navigations may commit in a transition. Preserve consecutive input
  // changes made before that commit instead of rebuilding from a stale URL.
  const pending = useRef({ source: params.toString(), params: new URLSearchParams(params) });
  const setParams = useCallback(
    (
      next: URLSearchParams | ((current: URLSearchParams) => URLSearchParams),
      options?: { replace?: boolean },
    ) => {
      if (pending.current.source !== params.toString()) {
        pending.current = { source: params.toString(), params: new URLSearchParams(params) };
      }
      const result =
        typeof next === 'function' ? next(new URLSearchParams(pending.current.params)) : next;
      pending.current.params = new URLSearchParams(result);
      navigateParams(result, options);
    },
    [params, navigateParams],
  );
  const state = readBrowseState(params);
  const { yearRange, ...filters } = state.filters;
  const setPage = useCallback(
    (page: number) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (page > 1) next.set('page', String(page));
          else next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return {
    ...state,
    params,
    setParams,
    setFilters: (filters: FilterState) =>
      setParams((previous) => {
        if (filters === DEFAULT_FILTERS) return writeBrowseFilters(previous, DEFAULT_FILTERS);
        const patch: Partial<FilterState> = {};
        for (const key of ['sortBy', 'sortOrder', 'minRating', 'yearRange', 'genre'] as const) {
          if (filters[key] !== state.filters[key]) Object.assign(patch, { [key]: filters[key] });
        }
        return writeBrowseFilters(previous, { ...readBrowseState(previous).filters, ...patch });
      }),
    setPage,
    clear: () => setParams(new URLSearchParams()),
    queryInput: {
      type: fixedType || state.type,
      search: state.search || undefined,
      ...filters,
      ...browseYearBounds(yearRange),
      page: state.page,
      limit: 18,
    },
  };
}

import { DEFAULT_FILTERS, SORT_OPTIONS, YEAR_OPTIONS, type FilterState } from './filterState';

/** Only known catalogue facets survive links or persisted views. */
export function readBrowseState(params: URLSearchParams) {
  const sort = SORT_OPTIONS.find(
    (item) =>
      item.value === `${params.get('sortBy') || 'createdAt'}:${params.get('sortOrder') || 'desc'}`,
  );
  const [sortBy, sortOrder] = (sort?.value || 'createdAt:desc').split(':') as [
    FilterState['sortBy'],
    FilterState['sortOrder'],
  ];
  const rating = Number.parseFloat(params.get('minRating') || '');
  const yearRange = YEAR_OPTIONS.some((item) => item.value === params.get('yearRange'))
    ? (params.get('yearRange') as FilterState['yearRange'])
    : 'all';
  const rawPage = Number(params.get('page') || 1);
  return {
    filters: {
      sortBy,
      sortOrder,
      yearRange,
      minRating:
        params.has('minRating') && Number.isFinite(rating) && rating >= 0 && rating <= 10
          ? rating
          : undefined,
      genre: params.get('genre')?.trim().slice(0, 100) || undefined,
    } satisfies FilterState,
    type:
      params.get('type') === 'movie'
        ? ('movie' as const)
        : params.get('type') === 'series'
          ? ('series' as const)
          : undefined,
    search: params.get('search')?.trim().slice(0, 200) || '',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function writeBrowseFilters(params: URLSearchParams, filters: FilterState) {
  const next = new URLSearchParams(params);
  for (const key of ['sortBy', 'sortOrder', 'minRating', 'yearRange', 'genre'] as const) {
    const value = filters[key];
    if (value === undefined || value === '' || value === DEFAULT_FILTERS[key]) next.delete(key);
    else next.set(key, String(value));
  }
  next.delete('page');
  return next;
}

export function canonicalBrowseQuery(params: URLSearchParams) {
  const state = readBrowseState(params);
  const result = writeBrowseFilters(new URLSearchParams(), state.filters);
  if (state.type) result.set('type', state.type);
  if (state.search) result.set('search', state.search);
  result.sort();
  return result.toString();
}

export function browseYearBounds(yearRange: FilterState['yearRange']) {
  if (yearRange === '2020s') return { yearFrom: 2020, yearTo: 2029 };
  if (yearRange === '2010s') return { yearFrom: 2010, yearTo: 2019 };
  if (yearRange === '2000s') return { yearFrom: 2000, yearTo: 2009 };
  if (yearRange === 'classics') return { yearTo: 1999 };
  return {};
}

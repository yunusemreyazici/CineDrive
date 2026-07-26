import { t } from '../../i18n';

/**
 * The filter model and its vocabulary, kept apart from the panel that renders
 * it: the library page needs to describe active filters as chips even while the
 * panel is closed, and a component file that also exports helpers breaks fast
 * refresh.
 */

export interface FilterState {
  sortBy: 'createdAt' | 'voteAverage' | 'year' | 'title';
  sortOrder: 'asc' | 'desc';
  minRating?: number;
  yearRange?: 'all' | '2020s' | '2010s' | '2000s' | 'classics';
  genre?: string;
}

export const DEFAULT_FILTERS: FilterState = {
  sortBy: 'createdAt',
  sortOrder: 'desc',
  minRating: undefined,
  yearRange: 'all',
  genre: undefined,
};

export const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: t.filters.sortNewest },
  { value: 'voteAverage:desc', label: t.filters.sortRating },
  { value: 'year:desc', label: t.filters.sortYearDesc },
  { value: 'year:asc', label: t.filters.sortYearAsc },
  { value: 'title:asc', label: t.filters.sortTitle },
];

export const RATING_OPTIONS = [
  { value: 'all', label: t.filters.allRatings },
  { value: '8.0', label: t.filters.ratingTop },
  { value: '7.5', label: t.filters.rating75 },
  { value: '7.0', label: t.filters.rating70 },
  { value: '6.0', label: t.filters.rating60 },
];

export const YEAR_OPTIONS = [
  { value: 'all', label: t.filters.allYears },
  { value: '2020s', label: t.filters.year2020s },
  { value: '2010s', label: t.filters.year2010s },
  { value: '2000s', label: t.filters.year2000s },
  { value: 'classics', label: t.filters.yearClassics },
];

export interface ActiveFilter {
  key: keyof FilterState | 'sort';
  label: string;
  clear: (filters: FilterState) => FilterState;
}

/**
 * What the user has narrowed the library down to, in their own words.
 *
 * The panel used to be permanently expanded because a collapsed one would have
 * hidden its own state; describing the active filters as removable chips lets
 * the four dropdowns fold away without anything becoming invisible.
 */
export const activeFilters = (filters: FilterState): ActiveFilter[] => {
  const active: ActiveFilter[] = [];

  const sortValue = `${filters.sortBy}:${filters.sortOrder}`;
  if (sortValue !== 'createdAt:desc') {
    active.push({
      key: 'sort',
      label: SORT_OPTIONS.find((option) => option.value === sortValue)?.label || sortValue,
      clear: (current) => ({ ...current, sortBy: 'createdAt', sortOrder: 'desc' }),
    });
  }

  if (filters.minRating !== undefined) {
    active.push({
      key: 'minRating',
      label:
        RATING_OPTIONS.find((option) => option.value === filters.minRating?.toFixed(1))?.label ||
        String(filters.minRating),
      clear: (current) => ({ ...current, minRating: undefined }),
    });
  }

  if (filters.yearRange && filters.yearRange !== 'all') {
    active.push({
      key: 'yearRange',
      label: YEAR_OPTIONS.find((option) => option.value === filters.yearRange)?.label || '',
      clear: (current) => ({ ...current, yearRange: 'all' }),
    });
  }

  if (filters.genre) {
    active.push({
      key: 'genre',
      label: filters.genre,
      clear: (current) => ({ ...current, genre: undefined }),
    });
  }

  return active;
};

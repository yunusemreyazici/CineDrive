import React, { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { t } from '../../i18n';
import {
  DEFAULT_FILTERS,
  RATING_OPTIONS,
  SORT_OPTIONS,
  YEAR_OPTIONS,
  activeFilters,
  type FilterState,
} from './filterState';

const SELECT_CLASSES =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40';

const LABEL_CLASSES = 'block text-[13px] font-medium text-zinc-400';

interface FilterPanelProps {
  filters: FilterState;
  onChange: (newFilters: FilterState) => void;
  availableGenres?: string[];
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onChange,
  availableGenres = t.filters.defaultGenres,
}) => {
  const fieldId = useId();
  const hasActiveFilters = activeFilters(filters).length > 0;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-sort`} className={LABEL_CLASSES}>
            {t.filters.sortBy}
          </label>
          <select
            id={`${fieldId}-sort`}
            value={`${filters.sortBy}:${filters.sortOrder}`}
            onChange={(e) => {
              const [sortBy, sortOrder] = e.target.value.split(':') as [
                FilterState['sortBy'],
                FilterState['sortOrder'],
              ];
              onChange({ ...filters, sortBy, sortOrder });
            }}
            className={SELECT_CLASSES}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-rating`} className={LABEL_CLASSES}>
            {t.filters.minRating}
          </label>
          <select
            id={`${fieldId}-rating`}
            value={filters.minRating?.toFixed(1) || 'all'}
            onChange={(e) =>
              onChange({
                ...filters,
                minRating: e.target.value === 'all' ? undefined : parseFloat(e.target.value),
              })
            }
            className={SELECT_CLASSES}
          >
            {RATING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-year`} className={LABEL_CLASSES}>
            {t.filters.yearRange}
          </label>
          <select
            id={`${fieldId}-year`}
            value={filters.yearRange || 'all'}
            onChange={(e) =>
              onChange({ ...filters, yearRange: e.target.value as FilterState['yearRange'] })
            }
            className={SELECT_CLASSES}
          >
            {YEAR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-genre`} className={LABEL_CLASSES}>
            {t.filters.genre}
          </label>
          <select
            id={`${fieldId}-genre`}
            value={filters.genre || 'all'}
            onChange={(e) =>
              onChange({ ...filters, genre: e.target.value === 'all' ? undefined : e.target.value })
            }
            className={SELECT_CLASSES}
          >
            <option value="all">{t.filters.allGenres}</option>
            {availableGenres.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t.filters.reset}
        </button>
      )}
    </div>
  );
};

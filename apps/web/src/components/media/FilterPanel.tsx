import React, { useId } from 'react';
import { Filter, Star, Calendar, ArrowUpDown, RotateCcw } from 'lucide-react';
import { t } from '../../i18n';

export interface FilterState {
  sortBy: 'createdAt' | 'voteAverage' | 'year' | 'title';
  sortOrder: 'asc' | 'desc';
  minRating?: number;
  yearRange?: 'all' | '2020s' | '2010s' | '2000s' | 'classics';
  genre?: string;
}

interface FilterPanelProps {
  filters: FilterState;
  onChange: (newFilters: FilterState) => void;
  availableGenres?: string[];
  totalResults?: number;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onChange,
  availableGenres = t.filters.defaultGenres,
  totalResults,
}) => {
  const fieldId = useId();
  const isFiltered =
    filters.sortBy !== 'createdAt' ||
    filters.minRating !== undefined ||
    (filters.yearRange && filters.yearRange !== 'all') ||
    !!filters.genre;

  const handleReset = () => {
    onChange({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      minRating: undefined,
      yearRange: 'all',
      genre: undefined,
    });
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-4 md:p-5 backdrop-blur-md space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-brand-500/10 text-brand-400 rounded-lg">
            <Filter className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white font-display">{t.filters.heading}</h3>
          {totalResults !== undefined && (
            <span className="text-xs text-zinc-400 font-mono">{t.filters.resultCount(totalResults)}</span>
          )}
        </div>

        {isFiltered && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.filters.reset}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Sort By Dropdown */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-sort`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <ArrowUpDown className="w-3.5 h-3.5 text-brand-400" />
            {t.filters.sortBy}
          </label>
          <select
            id={`${fieldId}-sort`}
            value={`${filters.sortBy}:${filters.sortOrder}`}
            onChange={(e) => {
              const [sBy, sOrd] = e.target.value.split(':') as [
                FilterState['sortBy'],
                FilterState['sortOrder'],
              ];
              onChange({ ...filters, sortBy: sBy, sortOrder: sOrd });
            }}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="createdAt:desc">{t.filters.sortNewest}</option>
            <option value="voteAverage:desc">{t.filters.sortRating}</option>
            <option value="year:desc">{t.filters.sortYearDesc}</option>
            <option value="year:asc">{t.filters.sortYearAsc}</option>
            <option value="title:asc">{t.filters.sortTitle}</option>
          </select>
        </div>

        {/* IMDb Rating Filter */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-rating`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {t.filters.minRating}
          </label>
          <select
            id={`${fieldId}-rating`}
            value={filters.minRating || 'all'}
            onChange={(e) => {
              const val = e.target.value === 'all' ? undefined : parseFloat(e.target.value);
              onChange({ ...filters, minRating: val });
            }}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="all">{t.filters.allRatings}</option>
            <option value="8.0">{t.filters.ratingTop}</option>
            <option value="7.5">{t.filters.rating75}</option>
            <option value="7.0">{t.filters.rating70}</option>
            <option value="6.0">{t.filters.rating60}</option>
          </select>
        </div>

        {/* Release Year Range */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-year`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            {t.filters.yearRange}
          </label>
          <select
            id={`${fieldId}-year`}
            value={filters.yearRange || 'all'}
            onChange={(e) => {
              const val = e.target.value as FilterState['yearRange'];
              onChange({ ...filters, yearRange: val });
            }}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="all">{t.filters.allYears}</option>
            <option value="2020s">{t.filters.year2020s}</option>
            <option value="2010s">{t.filters.year2010s}</option>
            <option value="2000s">{t.filters.year2000s}</option>
            <option value="classics">{t.filters.yearClassics}</option>
          </select>
        </div>

        {/* Genre Selector */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-genre`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-purple-400" />
            {t.filters.genre}
          </label>
          <select
            id={`${fieldId}-genre`}
            value={filters.genre || 'all'}
            onChange={(e) => {
              const val = e.target.value === 'all' ? undefined : e.target.value;
              onChange({ ...filters, genre: val });
            }}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="all">{t.filters.allGenres}</option>
            {availableGenres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

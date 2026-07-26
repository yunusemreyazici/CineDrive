import React, { useId } from 'react';
import { Filter, Star, Calendar, ArrowUpDown, RotateCcw } from 'lucide-react';

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
  availableGenres = [
    'Aksiyon',
    'Macera',
    'Animasyon',
    'Komedi',
    'Suç',
    'Belgesel',
    'Dram',
    'Fantezi',
    'Korku',
    'Gizem',
    'Romantik',
    'Bilim Kurgu',
    'Gerilim',
  ],
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
          <h3 className="text-sm font-bold text-white font-display">Gelişmiş Filtrele & Sırala</h3>
          {totalResults !== undefined && (
            <span className="text-xs text-zinc-400 font-mono">({totalResults} sonuç)</span>
          )}
        </div>

        {isFiltered && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Filtreleri Sıfırla</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Sort By Dropdown */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-sort`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <ArrowUpDown className="w-3.5 h-3.5 text-brand-400" />
            Sıralama Ölçütü
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
            <option value="createdAt:desc">En Yeniler (Eklenme Tarihi)</option>
            <option value="voteAverage:desc">IMDb Puanı (Yüksek → Düşük)</option>
            <option value="year:desc">Yapım Yılı (Yeni → Eski)</option>
            <option value="year:asc">Yapım Yılı (Eski → Yeni)</option>
            <option value="title:asc">İsim (A-Z)</option>
          </select>
        </div>

        {/* IMDb Rating Filter */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-rating`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            Minimum IMDb Puanı
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
            <option value="all">Tüm Puanlar</option>
            <option value="8.0">★ 8.0 ve Üzeri (Top İçerikler)</option>
            <option value="7.5">★ 7.5 ve Üzeri</option>
            <option value="7.0">★ 7.0 ve Üzeri</option>
            <option value="6.0">★ 6.0 ve Üzeri</option>
          </select>
        </div>

        {/* Release Year Range */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-year`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            Yapım Yılı Aralığı
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
            <option value="all">Tüm Dönemler</option>
            <option value="2020s">2020 ve Sonrası (Güncel)</option>
            <option value="2010s">2010 - 2019 Dönemi</option>
            <option value="2000s">2000 - 2009 Dönemi</option>
            <option value="classics">2000 Öncesi (Klasikler)</option>
          </select>
        </div>

        {/* Genre Selector */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-genre`} className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-purple-400" />
            Film / Dizi Türü
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
            <option value="all">Tüm Türler</option>
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

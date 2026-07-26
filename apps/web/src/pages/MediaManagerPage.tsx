import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database,
  Search,
  Trash2,
  CheckSquare,
  Square,
  Film,
  Tv,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Info,
} from 'lucide-react';
import { useMediaListQuery, useBatchDeleteMediaMutation } from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import type { MediaItemType } from '../types/media';

export const MediaManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: mediaData, isLoading } = useMediaListQuery(
    { limit: 500 },
    { respectVisibilityPreference: false },
  );
  const batchDeleteMutation = useBatchDeleteMediaMutation();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'movie' | 'series'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Memoized so the fallback empty array does not create a new identity on
  // every render and invalidate the filter below.
  const allItems: MediaItemType[] = useMemo(() => mediaData?.media || [], [mediaData]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      const matchesType = typeFilter === 'all' || item.type === typeFilter;
      const matchesSearch =
        !search ||
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        (item.originalTitle && item.originalTitle.toLowerCase().includes(search.toLowerCase()));
      return matchesType && matchesSearch;
    });
  }, [allItems, typeFilter, search]);

  const isAllSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      const allFilteredIds = new Set(filteredItems.map((item) => item.id));
      setSelectedIds(allFilteredIds);
    }
  };

  const handleItemClick = (e: React.MouseEvent, index: number, id: string) => {
    const newSelected = new Set(selectedIds);

    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const rangeItems = filteredItems.slice(start, end + 1);

      const targetSelected = !selectedIds.has(id);
      rangeItems.forEach((item) => {
        if (targetSelected) newSelected.add(item.id);
        else newSelected.delete(item.id);
      });
    } else {
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setLastClickedIndex(index);
    }

    setSelectedIds(newSelected);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await batchDeleteMutation.mutateAsync(Array.from(selectedIds));
      setSelectedIds(new Set());
      setLastClickedIndex(null);
      setShowConfirmModal(false);
    } catch {
      // Handled by react-query
    }
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-brand-600/20 text-brand-400 rounded-2xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold font-display text-white">Veri Yönetimi & Toplu Silme</h1>
            <p className="text-xs text-zinc-400">
              Veritabanındaki medyaları görün, Shift + Tıklama ile çoklu seçin ve kaldırın
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-semibold text-zinc-300">
            Toplam: <strong className="text-brand-400">{allItems.length}</strong> İçerik
          </span>
        </div>
      </div>

      {/* Info Tip Banner */}
      <div className="p-4 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl flex items-center gap-3 text-xs text-zinc-300">
        <Info className="w-5 h-5 text-brand-400 flex-shrink-0" />
        <p>
          <strong>Shift + Tıklama İpucu:</strong> Bir içeriği seçtikten sonra klavyeden <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-brand-300 font-mono">Shift</kbd> tuşuna basılı tutup başka bir içeriğe tıklarsanız, aradaki tüm içerikler otomatik seçilir.
        </p>
      </div>

      {/* Controls Bar: Search & Type Filter & Select All */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="İçerik başlığı ile ara..."
            className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 transition-colors"
          />
        </div>

        {/* Filters & Select All */}
        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                typeFilter === 'all'
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Tümü
            </button>
            <button
              onClick={() => setTypeFilter('movie')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                typeFilter === 'movie'
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Filmler
            </button>
            <button
              onClick={() => setTypeFilter('series')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                typeFilter === 'series'
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Diziler
            </button>
          </div>

          <button
            onClick={handleSelectAllToggle}
            className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-semibold text-zinc-200 rounded-xl transition-all"
          >
            {isAllSelected ? (
              <CheckSquare className="w-4 h-4 text-brand-400" />
            ) : (
              <Square className="w-4 h-4 text-zinc-500" />
            )}
            {isAllSelected ? 'Seçimi Kaldır' : 'Tümünü Seç'}
          </button>
        </div>
      </div>

      {/* Media Items Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-zinc-900/60 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="Medya Bulunamadı"
          description="Arama kriterlerinize uyan hiçbir medya bulunamadı."
        />
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/80 text-zinc-400 font-semibold border-b border-zinc-800">
                <tr>
                  <th className="p-4 w-12 text-center">#</th>
                  <th className="p-4">İçerik</th>
                  <th className="p-4">Tür</th>
                  <th className="p-4">Yıl</th>
                  <th className="p-4">Puan</th>
                  <th className="p-4 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                {filteredItems.map((item, index) => {
                  const isSelected = selectedIds.has(item.id);
                  const posterUrl =
                    item.posterUrl ||
                    (item.posterDriveFileId
                      ? `/api/media/assets/${item.posterDriveFileId}`
                      : null);

                  return (
                    <tr
                      key={item.id}
                      onClick={(e) => handleItemClick(e, index, item.id)}
                      className={`cursor-pointer transition-colors select-none ${
                        isSelected
                          ? 'bg-brand-600/15 hover:bg-brand-600/25 border-l-4 border-brand-500'
                          : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      {/* Checkbox column */}
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Handled by tr onClick
                          className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-brand-500 focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Content Info */}
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-14 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0 border border-zinc-700/50">
                            {posterUrl ? (
                              <img
                                src={posterUrl}
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                                {item.type === 'movie' ? (
                                  <Film className="w-5 h-5" />
                                ) : (
                                  <Tv className="w-5 h-5" />
                                )}
                              </div>
                            )}
                          </div>

                          <div>
                            <p className="font-bold text-white text-sm hover:text-brand-400 transition-colors">
                              {item.title}
                            </p>
                            {item.originalTitle && (
                              <p className="text-[11px] text-zinc-500 italic">
                                {item.originalTitle}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                            item.type === 'movie'
                              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                              : 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                          }`}
                        >
                          {item.type === 'movie' ? 'Film' : 'Dizi'}
                        </span>
                      </td>

                      {/* Year */}
                      <td className="p-4 font-mono font-medium text-zinc-400">
                        {item.year || '—'}
                      </td>

                      {/* Rating */}
                      <td className="p-4 font-mono font-bold text-amber-400">
                        {item.voteAverage ? `${item.voteAverage.toFixed(1)} / 10` : '—'}
                      </td>

                      {/* Detail Link */}
                      <td className="p-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/media/${item.id}`);
                          }}
                          className="p-2 text-zinc-400 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 rounded-xl transition-all"
                          title="Detay Sayfasına Git"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Action Bar when Items Selected */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-900/95 border border-zinc-700/80 rounded-2xl shadow-2xl px-6 py-4 flex items-center gap-6 backdrop-blur-xl animate-in slide-in-from-bottom-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold">
              {selectedIds.size}
            </span>
            <span>İçerik Seçildi</span>
          </div>

          <div className="h-6 w-px bg-zinc-700" />

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3.5 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
            >
              Seçimi İptal Et
            </button>

            <button
              onClick={() => setShowConfirmModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Seçilenleri Veritabanından Sil ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-500/20 text-rose-400 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-display">Toplu Silme Onayı</h3>
                <p className="text-xs text-zinc-400">Veritabanından kaldırılacak</p>
              </div>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed">
              Seçtiğiniz <strong className="text-white">{selectedIds.size} adet</strong> medya içeriği veritabanından silinecektir. Google Drive üzerindeki orijinal dosyalarınıza dokunulmaz. Devam etmek istiyor musunuz?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={batchDeleteMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50"
              >
                {batchDeleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Siliniyor...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Evet, {selectedIds.size} İçeriği Sil
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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
  ExternalLink,
  Info,
} from 'lucide-react';
import { useMediaListQuery, useBatchDeleteMediaMutation } from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import { Modal } from '../components/common/Modal';
import {
  SettingsButton,
  SettingsCard,
  SettingsStatus,
  SETTINGS_INPUT_CLASSES,
} from './settings/SettingsCard';
import { t } from '../i18n';
import type { MediaItemType } from '../types/media';
import { LibraryVisibilitySection } from './settings/sections/AppearanceSection';
import { DatabaseSection } from './settings/sections/DatabaseSection';

type TypeFilter = 'all' | 'movie' | 'series';

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: t.common.all },
  { id: 'movie', label: t.common.movies },
  { id: 'series', label: t.common.seriesPlural },
];

export const MediaManagerPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: mediaData, isLoading } = useMediaListQuery(
    { limit: 500 },
    { respectVisibilityPreference: false },
  );
  const batchDeleteMutation = useBatchDeleteMediaMutation();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
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
      setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    }
  };

  /** Plain toggle — the path a keyboard uses through the row's checkbox. */
  const toggleOne = (index: number, id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLastClickedIndex(index);
    setSelectedIds(next);
  };

  const handleItemClick = (e: React.MouseEvent, index: number, id: string) => {
    if (!e.shiftKey || lastClickedIndex === null) {
      toggleOne(index, id);
      return;
    }

    const next = new Set(selectedIds);
    const start = Math.min(lastClickedIndex, index);
    const end = Math.max(lastClickedIndex, index);
    const targetSelected = !selectedIds.has(id);

    filteredItems.slice(start, end + 1).forEach((item) => {
      if (targetSelected) next.add(item.id);
      else next.delete(item.id);
    });

    setSelectedIds(next);
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
    <div className="pb-8">
      <LibraryVisibilitySection />

      <SettingsCard
        id="settings-manage"
        title={t.mediaManager.title}
        description={t.mediaManager.subtitle}
        icon={Database}
        width="full"
        action={
          <SettingsStatus tone="neutral">
            {t.mediaManager.totalLabel} {allItems.length} {t.mediaManager.totalSuffix}
          </SettingsStatus>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.mediaManager.searchPlaceholder}
                aria-label={t.mediaManager.searchPlaceholder}
                className={`${SETTINGS_INPUT_CLASSES} pl-9`}
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-zinc-800 p-0.5">
                {TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={typeFilter === filter.id}
                    onClick={() => setTypeFilter(filter.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                      typeFilter === filter.id
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <SettingsButton
                variant="secondary"
                icon={isAllSelected ? CheckSquare : Square}
                onClick={handleSelectAllToggle}
              >
                {isAllSelected ? t.mediaManager.clearSelection : t.mediaManager.selectAll}
              </SettingsButton>
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-500">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="font-medium text-zinc-400">
                {t.mediaManager.shiftHintTitle}
              </strong>{' '}
              {t.mediaManager.shiftHintBefore}{' '}
              <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] text-zinc-300">
                Shift
              </kbd>{' '}
              {t.mediaManager.shiftHintAfter}
            </span>
          </p>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-900/60" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <EmptyState
              title={t.mediaManager.notFoundTitle}
              description={t.mediaManager.notFoundDescription}
            />
          ) : (
            <div className="overflow-x-auto border-y border-zinc-800/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    <th className="w-10 py-2.5 pl-1 pr-2" />
                    <th className="py-2.5 pr-4 text-xs font-medium text-zinc-500">
                      {t.mediaManager.columnContent}
                    </th>
                    <th className="py-2.5 pr-4 text-xs font-medium text-zinc-500">
                      {t.mediaManager.columnType}
                    </th>
                    <th className="py-2.5 pr-4 text-xs font-medium text-zinc-500">
                      {t.mediaManager.columnYear}
                    </th>
                    <th className="py-2.5 pr-4 text-xs font-medium text-zinc-500">
                      {t.mediaManager.columnRating}
                    </th>
                    <th className="py-2.5 pl-4 text-right text-xs font-medium text-zinc-500">
                      {t.mediaManager.columnAction}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
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
                        className={`cursor-pointer select-none transition-colors ${
                          isSelected ? 'bg-brand-500/[0.07]' : 'hover:bg-zinc-900/50'
                        }`}
                      >
                        <td className="py-2.5 pl-1 pr-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            // Its own handler, so selection is reachable by
                            // keyboard. It used to be a no-op with the row's
                            // click doing all the work.
                            onChange={() => toggleOne(index, item.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t.mediaManager.selectRow(item.title)}
                            className="h-4 w-4 cursor-pointer rounded border-zinc-700 bg-zinc-800 text-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                        </td>

                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-zinc-800">
                              {posterUrl ? (
                                <img
                                  src={posterUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-zinc-600">
                                  {item.type === 'movie' ? (
                                    <Film className="h-4 w-4" />
                                  ) : (
                                    <Tv className="h-4 w-4" />
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-zinc-100">
                                {item.title}
                              </p>
                              {item.originalTitle && (
                                <p className="truncate text-xs text-zinc-500">
                                  {item.originalTitle}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 pr-4 text-xs text-zinc-400">
                          {item.type === 'movie' ? t.common.movie : t.common.series}
                        </td>

                        <td className="py-2.5 pr-4 font-mono text-xs text-zinc-400">
                          {item.year || '—'}
                        </td>

                        <td className="py-2.5 pr-4 font-mono text-xs text-zinc-300">
                          {item.voteAverage ? item.voteAverage.toFixed(1) : '—'}
                        </td>

                        <td className="py-2.5 pl-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/media/${item.id}`);
                            }}
                            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            title={t.mediaManager.goToDetail}
                            aria-label={t.mediaManager.goToDetail}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SettingsCard>

      <DatabaseSection />

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-zinc-700/80 bg-zinc-900/95 px-4 py-3 shadow-xl backdrop-blur-xl">
          <span className="text-[13px] text-zinc-200">
            <strong className="font-semibold text-white">{selectedIds.size}</strong>{' '}
            {t.mediaManager.selectedSuffix}
          </span>

          <span className="h-5 w-px bg-zinc-700" />

          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {t.mediaManager.cancelSelection}
          </button>

          <SettingsButton variant="danger" icon={Trash2} onClick={() => setShowConfirmModal(true)}>
            {t.mediaManager.deleteSelected(selectedIds.size)}
          </SettingsButton>
        </div>
      )}

      {/*
        Was a hand-rolled overlay: no focus trap, no Escape, no dialog role.
        The shared Modal is the one every other confirmation already uses.
      */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        size="sm"
        title={t.mediaManager.bulkDeleteTitle}
        description={t.mediaManager.bulkDeleteSubtitle}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <SettingsButton variant="secondary" onClick={() => setShowConfirmModal(false)}>
              {t.common.cancel}
            </SettingsButton>
            <SettingsButton
              variant="danger"
              icon={Trash2}
              onClick={handleBatchDelete}
              isLoading={batchDeleteMutation.isPending}
              loadingLabel={t.mediaDetail.deleting}
            >
              {t.mediaManager.bulkDeleteConfirm(selectedIds.size)}
            </SettingsButton>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          {t.mediaManager.bulkDeleteBodyPrefix}{' '}
          <strong className="text-white">
            {t.mediaManager.bulkDeleteCount(selectedIds.size)}
          </strong>{' '}
          {t.mediaManager.bulkDeleteBodySuffix}
        </p>
      </Modal>
    </div>
  );
};

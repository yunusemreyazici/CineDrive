import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Calendar, Film, Monitor, Smartphone, Tablet, Trash2 } from 'lucide-react';
import {
  useWatchHistoryQuery,
  useDeleteHistoryMutation,
  useClearWatchHistoryMutation,
} from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Modal } from '../components/common/Modal';
import { toast } from '../stores/useToastStore';
import { getPosterUrl } from '../utils/mediaImages';
import { t } from '../i18n';

const FILTER_SELECT_CLASSES =
  'rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40';

type HistoryFilterType = 'all' | 'movie' | 'series';
type DurationFilter = 'all' | 'short' | 'medium' | 'long';
type DeviceFilter = 'all' | 'desktop' | 'tablet' | 'mobile';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<HistoryFilterType>('all');
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');
  const [episodesOnly, setEpisodesOnly] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const { data: historyItems, isLoading, isError, error, refetch } = useWatchHistoryQuery();
  const deleteHistoryMutation = useDeleteHistoryMutation();
  const clearHistoryMutation = useClearWatchHistoryMutation();

  // `window.confirm` blocks the tab with a browser chrome dialog that ignores
  // the app's focus handling and styling; every other destructive action here
  // already confirms through the shared Modal.
  const handleClearAllHistory = () => {
    clearHistoryMutation.mutate(undefined, {
      onSuccess: () => {
        setShowClearConfirm(false);
        toast.success(t.history.cleared);
      },
      onError: (error) => toast.fromError(error, t.history.clearFailed),
    });
  };

  const formatFriendlyDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t.history.today;
    if (diffDays === 1) return t.history.yesterday;
    if (diffDays < 7) return t.history.daysAgo(diffDays);

    return date.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const filteredItems = (historyItems || []).filter((item) => {
    if (activeFilter === 'movie' && item.mediaItem.type !== 'movie') return false;
    if (activeFilter === 'series' && item.mediaItem.type !== 'series') return false;
    if (episodesOnly && !item.episodeId) return false;
    const watchedMinutes = item.positionSeconds / 60;
    if (durationFilter === 'short' && watchedMinutes >= 15) return false;
    if (durationFilter === 'medium' && (watchedMinutes < 15 || watchedMinutes >= 45)) return false;
    if (durationFilter === 'long' && watchedMinutes < 45) return false;
    if (deviceFilter !== 'all' && item.deviceType !== deviceFilter) return false;
    return true;
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">
          {t.history.title}
        </h2>
        {historyItems && historyItems.length > 0 && (
          <span className="text-sm text-zinc-500">{t.history.itemCount(historyItems.length)}</span>
        )}
        <p className="w-full text-sm text-zinc-400">{t.history.subtitle}</p>
      </div>

      {/* One control row, matching the library. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-800 p-0.5 text-xs font-medium">
          {[
            { id: 'all', label: t.common.all },
            { id: 'movie', label: t.common.movies },
            { id: 'series', label: t.common.seriesPlural },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeFilter === tab.id}
              onClick={() => setActiveFilter(tab.id as HistoryFilterType)}
              className={`rounded-md px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                activeFilter === tab.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={durationFilter}
          onChange={(event) => setDurationFilter(event.target.value as DurationFilter)}
          aria-label={t.history.watchedDuration}
          className={FILTER_SELECT_CLASSES}
        >
          <option value="all">{t.history.allDurations}</option>
          <option value="short">{t.history.durationShort}</option>
          <option value="medium">{t.history.durationMedium}</option>
          <option value="long">{t.history.durationLong}</option>
        </select>

        <select
          value={deviceFilter}
          onChange={(event) => setDeviceFilter(event.target.value as DeviceFilter)}
          aria-label={t.history.device}
          className={FILTER_SELECT_CLASSES}
        >
          <option value="all">{t.history.allDevices}</option>
          <option value="desktop">{t.history.deviceDesktop}</option>
          <option value="tablet">{t.history.deviceTablet}</option>
          <option value="mobile">{t.history.deviceMobile}</option>
        </select>

        {/* Was styled exactly like the two selects beside it, despite toggling. */}
        <button
          type="button"
          role="switch"
          aria-checked={episodesOnly}
          onClick={() => setEpisodesOnly((value) => !value)}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            episodesOnly
              ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
              : 'border-zinc-800 text-zinc-400 hover:text-zinc-100'
          }`}
        >
          {t.history.episodesOnly}
        </button>

        {historyItems && historyItems.length > 0 && (
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={clearHistoryMutation.isPending}
            className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {clearHistoryMutation.isPending ? t.history.clearing : t.history.clearAll}
          </button>
        )}
      </div>

      {/* Content Section */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-zinc-900/40 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title={t.history.loadFailed} onRetry={() => void refetch()} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={t.history.emptyTitle}
          description={t.history.emptyDescription}
          actionLabel={t.history.exploreLibrary}
          onAction={() => navigate('/library')}
        />
      ) : (
        <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
          {filteredItems.map((item) => {
            const posterUrl = getPosterUrl(item.mediaItem);
            const watchHref = item.episodeId
              ? `/watch/${item.mediaItem.id}/${item.episodeId}`
              : `/watch/${item.mediaItem.id}`;

            return (
              <li key={item.id} className="group relative flex items-center gap-4 py-3">
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded bg-zinc-900">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-600">
                      <Film className="h-5 w-5" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {/*
                    The whole row is the link now. It used to be a plain div
                    with hover styling and a small button as the only way in —
                    and that button was an `<a href>`, so every "watch" click
                    reloaded the entire app instead of routing.
                  */}
                  <Link
                    to={watchHref}
                    className="after:absolute after:inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <span className="block truncate text-sm font-semibold text-zinc-100 group-hover:text-brand-300">
                      {item.mediaItem.title}
                      {item.episode && (
                        <span className="ml-2 text-xs font-normal text-zinc-400">
                          {item.episode.seasonNumber}x
                          {item.episode.episodeNumber < 10
                            ? `0${item.episode.episodeNumber}`
                            : item.episode.episodeNumber}{' '}
                          · {item.episode.title}
                        </span>
                      )}
                    </span>
                  </Link>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span className="uppercase tracking-wide">
                      {item.mediaItem.type === 'movie' ? t.common.movie : t.common.series}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatFriendlyDate(item.watchedAt)}
                    </span>
                    <span>
                      {t.history.watchedMinutes(
                        Math.max(1, Math.round(item.positionSeconds / 60)),
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      {item.deviceType === 'mobile' ? (
                        <Smartphone className="h-3 w-3" />
                      ) : item.deviceType === 'tablet' ? (
                        <Tablet className="h-3 w-3" />
                      ) : (
                        <Monitor className="h-3 w-3" />
                      )}
                      {item.deviceType === 'mobile'
                        ? t.history.deviceMobile
                        : item.deviceType === 'tablet'
                          ? t.history.deviceTablet
                          : item.deviceType === 'desktop'
                            ? t.history.deviceDesktop
                            : t.history.deviceUnknown}
                    </span>
                  </div>
                </div>

                {/* Above the stretched link, so it stays clickable. */}
                <button
                  onClick={() => deleteHistoryMutation.mutate(item.id)}
                  disabled={deleteHistoryMutation.isPending}
                  className="relative z-10 shrink-0 rounded-md p-2 text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                  aria-label={t.history.deleteEntry(item.mediaItem.title)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        size="sm"
        title={t.history.clearConfirmTitle}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              className="rounded-lg border border-zinc-700 px-3.5 py-2 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleClearAllHistory}
              disabled={clearHistoryMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-[13px] font-medium text-rose-300 transition-colors hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {clearHistoryMutation.isPending ? t.history.clearing : t.history.clearAll}
            </button>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">{t.history.clearConfirm}</p>
      </Modal>
    </div>
  );
};

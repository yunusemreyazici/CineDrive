import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History,
  Trash2,
  Play,
  Calendar,
  Film,
  Tv,
  Monitor,
  Smartphone,
  Tablet,
} from 'lucide-react';
import {
  useWatchHistoryQuery,
  useDeleteHistoryMutation,
  useClearWatchHistoryMutation,
} from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { parseApiError } from '../api/client';

type HistoryFilterType = 'all' | 'movie' | 'series';
type DurationFilter = 'all' | 'short' | 'medium' | 'long';
type DeviceFilter = 'all' | 'desktop' | 'tablet' | 'mobile';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<HistoryFilterType>('all');
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');
  const [episodesOnly, setEpisodesOnly] = useState(false);
  const { data: historyItems, isLoading, isError, error, refetch } = useWatchHistoryQuery();
  const deleteHistoryMutation = useDeleteHistoryMutation();
  const clearHistoryMutation = useClearWatchHistoryMutation();

  const handleClearAllHistory = async () => {
    if (
      !window.confirm(
        'Tüm izleme geçmişiniz ve kaldığınız yer bilgileri silinecek. Devam etmek istiyor musunuz?',
      )
    )
      return;

    clearHistoryMutation.mutate();
  };

  const formatFriendlyDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Bugün';
    if (diffDays === 1) return 'Dün';
    if (diffDays < 7) return `${diffDays} gün önce`;

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
    <div className="space-y-8 max-w-6xl">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-brand-600/20 border border-brand-500/30 text-brand-400 rounded-2xl">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">
              İzleme Geçmişi
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Daha önce izlediğiniz tüm içeriklerin kaydı
            </p>
          </div>
        </div>

        {historyItems && historyItems.length > 0 && (
          <button
            onClick={handleClearAllHistory}
            disabled={clearHistoryMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl transition-colors self-start sm:self-auto"
          >
            <Trash2 className="w-4 h-4" />
            {clearHistoryMutation.isPending ? 'Geçmiş Temizleniyor…' : 'Tüm Geçmişi Temizle'}
          </button>
        )}
      </div>

      {clearHistoryMutation.isError && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {parseApiError(clearHistoryMutation.error).message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span className="font-semibold">İzlenen süre</span>
          <select
            value={durationFilter}
            onChange={(event) => setDurationFilter(event.target.value as DurationFilter)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-zinc-200"
          >
            <option value="all">Tüm süreler</option>
            <option value="short">15 dakikadan az</option>
            <option value="medium">15–45 dakika</option>
            <option value="long">45 dakika ve üzeri</option>
          </select>
        </label>
        <label className="space-y-1.5 text-xs text-zinc-400">
          <span className="font-semibold">Cihaz</span>
          <select
            value={deviceFilter}
            onChange={(event) => setDeviceFilter(event.target.value as DeviceFilter)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-zinc-200"
          >
            <option value="all">Tüm cihazlar</option>
            <option value="desktop">Bilgisayar</option>
            <option value="tablet">Tablet</option>
            <option value="mobile">Telefon</option>
          </select>
        </label>
        <label className="flex items-end">
          <button
            type="button"
            role="switch"
            aria-checked={episodesOnly}
            onClick={() => setEpisodesOnly((value) => !value)}
            className={`w-full rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
              episodesOnly
                ? 'border-brand-500 bg-brand-600 text-white'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400'
            }`}
          >
            Yalnızca bölümler
          </button>
        </label>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {[
          { id: 'all', label: 'Tümü', icon: History },
          { id: 'movie', label: 'Filmler', icon: Film },
          { id: 'series', label: 'Diziler', icon: Tv },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as HistoryFilterType)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                activeFilter === tab.id
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20'
                  : 'bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 border border-zinc-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content Section */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-zinc-900/40 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} title="Geçmiş Yüklenemedi" onRetry={() => void refetch()} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="İzleme Geçmişi Boş"
          description="Henüz izlediğiniz bir içerik bulunmuyor. Medya kütüphanesinden izlemeye başlayabilirsiniz."
          actionLabel="Kütüphaneyi Keşfet"
          onAction={() => navigate('/library')}
        />
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-4 bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/60 rounded-2xl transition-all group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="relative w-16 h-20 bg-zinc-950 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-800">
                  {item.mediaItem.posterUrl ? (
                    <img
                      src={item.mediaItem.posterUrl}
                      alt={item.mediaItem.title}
                      className="w-full h-full object-cover"
                    />
                  ) : item.mediaItem.posterDriveFileId ? (
                    <img
                      src={`/api/media/assets/${item.mediaItem.posterDriveFileId}`}
                      alt={item.mediaItem.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      <Film className="w-6 h-6" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 text-[10px] font-bold text-zinc-300 rounded uppercase">
                      {item.mediaItem.type === 'movie' ? 'Film' : 'Dizi'}
                    </span>
                    <span className="text-xs text-zinc-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatFriendlyDate(item.watchedAt)}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold font-display text-white truncate">
                    {item.mediaItem.title}
                    {item.episode && (
                      <span className="text-zinc-400 font-normal ml-2 text-xs">
                        {item.episode.seasonNumber}x
                        {item.episode.episodeNumber < 10
                          ? `0${item.episode.episodeNumber}`
                          : item.episode.episodeNumber}{' '}
                        - {item.episode.title}
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                    <span>{Math.max(1, Math.round(item.positionSeconds / 60))} dk izlendi</span>
                    <span className="flex items-center gap-1">
                      {item.deviceType === 'mobile' ? (
                        <Smartphone className="h-3 w-3" />
                      ) : item.deviceType === 'tablet' ? (
                        <Tablet className="h-3 w-3" />
                      ) : (
                        <Monitor className="h-3 w-3" />
                      )}
                      {item.deviceType === 'mobile'
                        ? 'Telefon'
                        : item.deviceType === 'tablet'
                          ? 'Tablet'
                          : item.deviceType === 'desktop'
                            ? 'Bilgisayar'
                            : 'Bilinmiyor'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Group */}
              <div className="flex items-center gap-3">
                <a
                  href={
                    item.episodeId
                      ? `/watch/${item.mediaItem.id}/${item.episodeId}`
                      : `/watch/${item.mediaItem.id}`
                  }
                  className="p-3 bg-brand-600/20 hover:bg-brand-600 text-brand-400 hover:text-white border border-brand-500/30 rounded-xl transition-all flex items-center gap-1.5 text-xs font-semibold"
                  aria-label="İzlemeye Devam Et"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>İzle</span>
                </a>

                <button
                  onClick={() => deleteHistoryMutation.mutate(item.id)}
                  disabled={deleteHistoryMutation.isPending}
                  className="p-3 bg-zinc-800/60 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-500/30 rounded-xl transition-colors"
                  aria-label="Sil"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

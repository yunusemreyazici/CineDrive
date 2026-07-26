import React from 'react';
import { t } from '../i18n';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, Files, Copy, Film, Loader2 } from 'lucide-react';
import type { StorageInsightsDto, DuplicateFileDto } from '@cinedrive/shared';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const InsightsPage: React.FC = () => {
  const { data: insights, isLoading, refetch } = useQuery<StorageInsightsDto>({
    queryKey: ['storage-insights'],
    queryFn: async () => {
      const res = await fetch('/api/insights/storage');
      if (!res.ok) throw new Error('Insights fetch failed');
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
        <p className="text-sm font-medium text-zinc-400">{t.insights.loading}</p>
      </div>
    );
  }

  const {
    totalFiles = 0,
    totalSizeBytes = 0,
    averageSizeBytes = 0,
    resolutions = {
      k4: { count: 0, sizeBytes: 0 },
      p1080: { count: 0, sizeBytes: 0 },
      p720: { count: 0, sizeBytes: 0 },
      sd: { count: 0, sizeBytes: 0 },
    },
    duplicates = [],
    largestFiles = [],
  } = insights || {};

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header Title */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-xl font-extrabold text-white font-display flex items-center gap-3">
            <HardDrive className="w-8 h-8 text-brand-500" />
            Depolama ve Kota Analizi
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {t.insights.subtitle}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 rounded-xl transition-colors"
        >
          Yenile
        </button>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Toplam Alan</span>
            <HardDrive className="w-5 h-5 text-brand-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-display">
            {formatBytes(totalSizeBytes)}
          </div>
          <p className="text-[11px] text-zinc-500">{t.insights.totalSizeHint}</p>
        </div>

        <div className="p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{t.insights.fileCount}</span>
            <Files className="w-5 h-5 text-sky-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-display">{totalFiles} Adet</div>
          <p className="text-[11px] text-zinc-500">{t.insights.fileCountHint}</p>
        </div>

        <div className="p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Ortalama Boyut</span>
            <Film className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-display">
            {formatBytes(averageSizeBytes)}
          </div>
          <p className="text-[11px] text-zinc-500">{t.insights.averageSizeHint}</p>
        </div>

        <div className="p-5 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">{t.insights.duplicates}</span>
            <Copy className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-display">
            {duplicates.length} Adet
          </div>
          <p className="text-[11px] text-zinc-500">{t.insights.duplicatesHint}</p>
        </div>
      </div>

      {/* Resolution Breakdown */}
      <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-6">
        <h3 className="text-lg font-bold text-white font-display">{t.insights.resolutionDistribution}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 4K */}
          <div className="p-4 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-xs">
                4K Ultra HD
              </span>
              <span className="text-xs text-zinc-400">{resolutions.k4.count} Dosya</span>
            </div>
            <p className="text-lg font-bold text-white">{formatBytes(resolutions.k4.sizeBytes)}</p>
          </div>

          {/* 1080p */}
          <div className="p-4 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 font-bold text-xs">
                1080p Full HD
              </span>
              <span className="text-xs text-zinc-400">{resolutions.p1080.count} Dosya</span>
            </div>
            <p className="text-lg font-bold text-white">{formatBytes(resolutions.p1080.sizeBytes)}</p>
          </div>

          {/* 720p */}
          <div className="p-4 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-bold text-xs">
                720p HD
              </span>
              <span className="text-xs text-zinc-400">{resolutions.p720.count} Dosya</span>
            </div>
            <p className="text-lg font-bold text-white">{formatBytes(resolutions.p720.sizeBytes)}</p>
          </div>

          {/* SD */}
          <div className="p-4 bg-zinc-950/80 border border-zinc-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-bold text-xs">
                SD (480p)
              </span>
              <span className="text-xs text-zinc-400">{resolutions.sd.count} Dosya</span>
            </div>
            <p className="text-lg font-bold text-white">{formatBytes(resolutions.sd.sizeBytes)}</p>
          </div>
        </div>
      </div>

      {/* Duplicate Files List */}
      {duplicates.length > 0 && (
        <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
              <Copy className="w-5 h-5 text-amber-400" />
              {t.insights.duplicateList}
            </h3>
            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full font-medium">
              {duplicates.length} adet tespit edildi
            </span>
          </div>

          <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950">
            {duplicates.map((file: DuplicateFileDto) => (
              <div
                key={file.id}
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-zinc-900/60 transition-colors"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-200 truncate">{file.name}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span className="px-2 py-0.5 bg-zinc-800 rounded text-zinc-300">
                      {file.libraryName}
                    </span>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30 self-start md:self-auto">
                  {file.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top 10 Largest Video Files */}
      <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-4">
        <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
          <Film className="w-5 h-5 text-brand-400" />
          {t.insights.largestFiles}
        </h3>

        <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950">
          {largestFiles.map((file: { id: string; name: string; size: number; libraryName: string; googleDriveFileId: string }, idx: number) => (
            <div
              key={file.id}
              className="p-4 flex items-center justify-between gap-4 hover:bg-zinc-900/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="w-6 h-6 rounded-full bg-zinc-800 text-xs font-extrabold text-zinc-400 flex items-center justify-center flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-200 truncate">{file.name}</p>
                  <p className="text-xs text-zinc-500">{file.libraryName}</p>
                </div>
              </div>
              <span className="text-sm font-extrabold text-brand-400 font-display flex-shrink-0">
                {formatBytes(file.size)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

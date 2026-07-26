import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, Files, Copy, Film } from 'lucide-react';
import type { StorageInsightsDto, DuplicateFileDto } from '@cinedrive/shared';
import { apiClient } from '../api/client';
import { ErrorState } from '../components/common/ErrorState';
import { SettingsButton, SettingsCard, SettingsStatus } from './settings/SettingsCard';
import { t } from '../i18n';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

interface LargestFile {
  id: string;
  name: string;
  size: number;
  libraryName: string;
  googleDriveFileId: string;
}

/** Label, value and a one-line explanation — the settings summary rhythm. */
const Metric: React.FC<{ label: string; value: string; hint: string }> = ({
  label,
  value,
  hint,
}) => (
  <div>
    <p className="text-xs text-zinc-500">{label}</p>
    <p className="mt-1 font-display text-xl font-semibold text-white">{value}</p>
    <p className="mt-1 text-xs leading-relaxed text-zinc-500">{hint}</p>
  </div>
);

export const InsightsPage: React.FC = () => {
  const {
    data: insights,
    isLoading,
    error,
    refetch,
  } = useQuery<StorageInsightsDto>({
    queryKey: ['storage-insights'],
    // Went through a bare `fetch` before, which meant no credentials handling,
    // no shared error shape and — because only `isLoading` was checked — a
    // failed request rendered as a library full of zeroes.
    queryFn: async () => (await apiClient.get<StorageInsightsDto>('/insights/storage')).data,
  });

  if (error) {
    return <ErrorState error={error} title={t.insights.loadFailed} onRetry={() => refetch()} />;
  }

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t.insights.loading}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg bg-zinc-900/60" />
        ))}
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

  const resolutionRows = [
    { key: 'k4', label: t.insights.resolutionLabels.k4, ...resolutions.k4 },
    { key: 'p1080', label: t.insights.resolutionLabels.p1080, ...resolutions.p1080 },
    { key: 'p720', label: t.insights.resolutionLabels.p720, ...resolutions.p720 },
    { key: 'sd', label: t.insights.resolutionLabels.sd, ...resolutions.sd },
  ];

  return (
    <div>
      <SettingsCard
        id="insights-summary"
        title={t.insights.summary}
        description={t.insights.subtitle}
        icon={HardDrive}
        width="full"
        action={
          <SettingsButton variant="secondary" onClick={() => refetch()}>
            {t.insights.refresh}
          </SettingsButton>
        }
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t.insights.totalSize}
            value={formatBytes(totalSizeBytes)}
            hint={t.insights.totalSizeHint}
          />
          <Metric
            label={t.insights.fileCount}
            value={t.insights.itemCount(totalFiles)}
            hint={t.insights.fileCountHint}
          />
          <Metric
            label={t.insights.averageSize}
            value={formatBytes(averageSizeBytes)}
            hint={t.insights.averageSizeHint}
          />
          <Metric
            label={t.insights.duplicates}
            value={t.insights.itemCount(duplicates.length)}
            hint={t.insights.duplicatesHint}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        id="insights-resolutions"
        title={t.insights.resolutionDistribution}
        icon={Film}
        width="full"
      >
        <ul className="space-y-3.5">
          {resolutionRows.map((row) => {
            // A distribution is about proportion, so each row carries its own
            // share of the total rather than four differently coloured chips.
            const share = totalSizeBytes > 0 ? (row.sizeBytes / totalSizeBytes) * 100 : 0;

            return (
              <li key={row.key}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[13px] font-medium text-zinc-200">{row.label}</span>
                  <span className="text-xs text-zinc-500">
                    {t.insights.fileUnit(row.count)} · {formatBytes(row.sizeBytes)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-brand-500/70"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      {duplicates.length > 0 && (
        <SettingsCard
          id="insights-duplicates"
          title={t.insights.duplicateList}
          icon={Copy}
          width="full"
          action={
            <SettingsStatus tone="warning">
              {t.insights.duplicatesDetected(duplicates.length)}
            </SettingsStatus>
          }
        >
          <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
            {duplicates.map((file: DuplicateFileDto) => (
              <li
                key={file.id}
                className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between md:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-zinc-200">{file.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {file.libraryName} · {formatBytes(file.size)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-amber-400">{file.reason}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}

      <SettingsCard
        id="insights-largest"
        title={t.insights.largestFiles}
        icon={Files}
        width="full"
      >
        <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
          {largestFiles.map((file: LargestFile, index: number) => (
            <li key={file.id} className="flex items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-600">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-zinc-200">{file.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{file.libraryName}</p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[13px] text-zinc-300">
                {formatBytes(file.size)}
              </span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
};

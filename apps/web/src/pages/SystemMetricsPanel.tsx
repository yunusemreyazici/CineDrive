import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Gauge, HardDrive, MemoryStick, Network, Thermometer } from 'lucide-react';
import type { SystemMetricPointDto, SystemMetricsDto } from '@cinedrive/shared';
import { apiClient } from '../api/client';
import { ErrorState } from '../components/common/ErrorState';
import {
  SettingsButton,
  SettingsCard,
  SettingsMeter,
  SettingsMetric,
} from './settings/SettingsCard';
import { locale, t } from '../i18n';
import { buildDailyBandwidth } from '../utils/systemMetrics';

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return t.systemMetrics.unavailable;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exponent = Math.max(
    0,
    Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1),
  );
  return `${(bytes / 1024 ** exponent).toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[exponent]}`;
};

const formatRate = (bytes: number | null) =>
  bytes === null ? t.systemMetrics.collecting : `${formatBytes(bytes)}/s`;

const percentage = (used: number | null, total: number | null): number =>
  used !== null && total !== null && total > 0 ? (used / total) * 100 : 0;

const BandwidthChart: React.FC<{ history: SystemMetricPointDto[] }> = ({ history }) => {
  const days = buildDailyBandwidth(history);
  const maximum = Math.max(1, ...days.map((day) => day.receivedBytes + day.transmittedBytes));
  const chartHeight = 144;
  const baseline = 116;
  const usableHeight = 94;
  const barWidth = 28;
  const gap = 20;

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-zinc-500" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand-500" /> {t.systemMetrics.received}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-violet-500" /> {t.systemMetrics.transmitted}
        </span>
      </div>
      <svg
        className="mt-3 h-40 w-full overflow-visible"
        viewBox={`0 0 ${days.length * (barWidth + gap)} ${chartHeight}`}
        role="img"
        aria-label={t.systemMetrics.bandwidthChartLabel}
      >
        <line
          x1="0"
          x2={days.length * (barWidth + gap) - gap}
          y1={baseline}
          y2={baseline}
          stroke="currentColor"
          className="text-zinc-800"
        />
        {days.map((day, index) => {
          const x = index * (barWidth + gap);
          const receivedHeight = (day.receivedBytes / maximum) * usableHeight;
          const transmittedHeight = (day.transmittedBytes / maximum) * usableHeight;
          return (
            <g key={day.key}>
              <title>{`${day.label}: ${t.systemMetrics.received} ${formatBytes(day.receivedBytes)}, ${t.systemMetrics.transmitted} ${formatBytes(day.transmittedBytes)}`}</title>
              <rect
                x={x}
                y={baseline - receivedHeight}
                width={barWidth}
                height={receivedHeight}
                rx="3"
                className="fill-brand-500"
              />
              <rect
                x={x}
                y={baseline - receivedHeight - transmittedHeight}
                width={barWidth}
                height={transmittedHeight}
                rx="3"
                className="fill-violet-500"
              />
              <text
                x={x + barWidth / 2}
                y={136}
                textAnchor="middle"
                className="fill-zinc-500 text-[10px]"
              >
                {day.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const SystemMetricsPanel: React.FC = () => {
  const query = useQuery<SystemMetricsDto>({
    queryKey: ['system-metrics'],
    queryFn: async () => (await apiClient.get<SystemMetricsDto>('/system/metrics')).data,
    refetchInterval: 60_000,
  });

  if (query.error) {
    return (
      <ErrorState
        error={query.error}
        title={t.systemMetrics.loadFailed}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (query.isLoading || !query.data?.current) {
    return (
      <div
        className="mb-6 h-56 animate-pulse rounded-lg bg-zinc-900/60"
        aria-label={t.systemMetrics.loading}
      />
    );
  }

  const { current, history, sevenDayBandwidth, scope } = query.data;
  const memoryPercent = percentage(current.memoryUsedBytes, current.memoryTotalBytes);
  const diskPercent = percentage(current.diskUsedBytes, current.diskTotalBytes);

  return (
    <>
      <SettingsCard
        id="system-metrics"
        title={t.systemMetrics.title}
        description={t.systemMetrics.subtitle}
        icon={Activity}
        width="full"
        action={
          <SettingsButton variant="secondary" onClick={() => query.refetch()}>
            {t.systemMetrics.refresh}
          </SettingsButton>
        }
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <SettingsMetric
              label={t.systemMetrics.cpu}
              value={
                current.cpuPercent === null
                  ? t.systemMetrics.collecting
                  : `%${current.cpuPercent.toLocaleString(locale, { maximumFractionDigits: 1 })}`
              }
              hint={t.systemMetrics.scope[scope]}
            />
            <div className="mt-3">
              <SettingsMeter
                label={t.systemMetrics.utilization}
                value={current.cpuPercent === null ? '—' : `%${Math.round(current.cpuPercent)}`}
                share={current.cpuPercent || 0}
              />
            </div>
          </div>
          <div>
            <SettingsMetric
              label={t.systemMetrics.memory}
              value={formatBytes(current.memoryUsedBytes)}
              hint={t.systemMetrics.ofTotal(formatBytes(current.memoryTotalBytes))}
            />
            <div className="mt-3">
              <SettingsMeter
                label={t.systemMetrics.utilization}
                value={`%${Math.round(memoryPercent)}`}
                share={memoryPercent}
              />
            </div>
          </div>
          <div>
            <SettingsMetric
              label={t.systemMetrics.disk}
              value={formatBytes(current.diskUsedBytes)}
              hint={t.systemMetrics.ofTotal(formatBytes(current.diskTotalBytes))}
            />
            <div className="mt-3">
              <SettingsMeter
                label={t.systemMetrics.utilization}
                value={`%${Math.round(diskPercent)}`}
                share={diskPercent}
              />
            </div>
          </div>
          <SettingsMetric
            label={t.systemMetrics.temperature}
            value={
              current.temperatureCelsius === null
                ? t.systemMetrics.unavailable
                : `${current.temperatureCelsius.toLocaleString(locale, { maximumFractionDigits: 1 })} °C`
            }
            hint={t.systemMetrics.temperatureHint}
          />
        </div>

        <div className="mt-7 grid grid-cols-1 gap-4 border-t border-zinc-800/60 pt-5 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [HardDrive, t.systemMetrics.diskRead, formatRate(current.diskReadBytesPerSecond)],
            [Gauge, t.systemMetrics.diskWrite, formatRate(current.diskWriteBytesPerSecond)],
            [Network, t.systemMetrics.download, formatRate(current.networkReceiveBytesPerSecond)],
            [
              MemoryStick,
              t.systemMetrics.upload,
              formatRate(current.networkTransmitBytesPerSecond),
            ],
          ].map(([Icon, label, value]) => {
            const MetricIcon = Icon as typeof HardDrive;
            return (
              <div key={label as string} className="flex items-center gap-3">
                <MetricIcon className="h-4 w-4 text-zinc-600" />
                <div>
                  <p className="text-xs text-zinc-500">{label as string}</p>
                  <p className="mt-0.5 font-mono text-[13px] text-zinc-200">{value as string}</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-5 flex items-center gap-2 text-xs text-zinc-600">
          <Thermometer className="h-3.5 w-3.5" />
          {t.systemMetrics.sampledAt(new Date(current.recordedAt).toLocaleString(locale))}
        </p>
      </SettingsCard>

      <SettingsCard
        id="system-bandwidth"
        title={t.systemMetrics.bandwidthTitle}
        description={t.systemMetrics.bandwidthSubtitle}
        icon={Network}
        width="full"
        action={
          <span className="font-mono text-xs text-zinc-400">
            {formatBytes(sevenDayBandwidth.totalBytes)}
          </span>
        }
      >
        <div className="mb-5 grid grid-cols-2 gap-5 sm:max-w-lg">
          <SettingsMetric
            label={t.systemMetrics.received}
            value={formatBytes(sevenDayBandwidth.receivedBytes)}
          />
          <SettingsMetric
            label={t.systemMetrics.transmitted}
            value={formatBytes(sevenDayBandwidth.transmittedBytes)}
          />
        </div>
        <BandwidthChart history={history} />
        <p className="mt-2 text-xs leading-relaxed text-zinc-600">
          {t.systemMetrics.retentionHint(
            query.data.sampleIntervalSeconds,
            query.data.retentionDays,
          )}
        </p>
      </SettingsCard>
    </>
  );
};

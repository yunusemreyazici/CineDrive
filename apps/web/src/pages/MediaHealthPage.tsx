import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MediaHealthDto } from '@cinedrive/shared';
import { Activity, AlertTriangle, Clock, Film, RefreshCw, RotateCw, Server, Square } from 'lucide-react';
import { apiClient } from '../api/client';
import { ErrorState } from '../components/common/ErrorState';
import { toast } from '../stores/useToastStore';
import {
  SettingsButton,
  SettingsCard,
  SettingsMeter,
  SettingsMetric,
  SettingsStatus,
} from './settings/SettingsCard';
import { t } from '../i18n';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

const MODE_LABELS = {
  direct: t.mediaHealth.modeDirect,
  audio: t.mediaHealth.modeAudio,
  hls: t.mediaHealth.modeHls,
  full: t.mediaHealth.modeFull,
};

/** Counts compared against the largest of the set, not against a total. */
const Distribution: React.FC<{ items: Array<{ name: string; count: number }> }> = ({ items }) => {
  const maximum = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="space-y-3">
      {items.slice(0, 8).map((item) => (
        <SettingsMeter
          key={item.name}
          label={item.name}
          value={String(item.count)}
          share={(item.count / maximum) * 100}
        />
      ))}
    </div>
  );
};

export const MediaHealthPage: React.FC = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery<MediaHealthDto>({
    queryKey: ['media-health'],
    queryFn: async () => (await apiClient.get<MediaHealthDto>('/insights/media-health')).data,
    refetchInterval: 5_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['media-health'] });

  // Feedback used to render as a banner wedged between two sections, far from
  // the button that caused it. The app already has one place for this.
  const reanalyze = useMutation({
    mutationFn: async (driveFileId: string) =>
      (await apiClient.post<{ message: string }>(`/insights/media-health/${driveFileId}/reanalyze`))
        .data,
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (mutationError) => {
      toast.fromError(mutationError, t.mediaHealth.reanalyzeFailed);
      invalidate();
    },
  });

  const stopHlsJob = useMutation({
    mutationFn: async (jobId: string) =>
      (await apiClient.post<{ stopped: boolean }>(`/insights/media-health/hls/${jobId}/stop`)).data,
    onSuccess: () => {
      toast.success(t.mediaHealth.jobStopped);
      invalidate();
    },
    onError: (mutationError) => {
      toast.fromError(mutationError);
      invalidate();
    },
  });

  if (error) {
    return <ErrorState error={error} title={t.mediaHealth.loadFailed} onRetry={() => refetch()} />;
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t.mediaHealth.loading}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg bg-zinc-900/60" />
        ))}
      </div>
    );
  }

  const analyzedPercent = data.totalVideos
    ? Math.round((data.analyzedVideos / data.totalVideos) * 100)
    : 0;

  const { hls, transcode, playerTelemetry } = data.runtime;

  return (
    <div>
      <SettingsCard
        id="health-summary"
        title={t.mediaHealth.analysisSummary}
        description={t.mediaHealth.subtitle}
        icon={Activity}
        width="full"
        action={
          <SettingsButton
            variant="secondary"
            icon={RefreshCw}
            onClick={() => refetch()}
            isLoading={isFetching}
            loadingLabel={t.mediaHealth.refresh}
          >
            {t.mediaHealth.refresh}
          </SettingsButton>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
            <SettingsMetric label={t.mediaHealth.totalVideos} value={data.totalVideos} />
            <SettingsMetric
              label={t.mediaHealth.analysisComplete}
              value={`%${analyzedPercent}`}
            />
            <SettingsMetric label={t.mediaHealth.pendingVideos} value={data.pendingVideos} />
            <SettingsMetric
              label={t.mediaHealth.failedFiles}
              value={
                // The only number here that is bad news when it is not zero.
                <span className={data.failedVideos > 0 ? 'text-rose-400' : undefined}>
                  {data.failedVideos}
                </span>
              }
            />
          </div>

          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-brand-500/70"
              style={{ width: `${analyzedPercent}%` }}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="health-playback-plan"
        title={t.mediaHealth.playbackPlans}
        description={t.mediaHealth.playbackPlansHint}
        icon={Film}
        width="full"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {(['safari', 'chromium'] as const).map((browser) => (
            <div key={browser}>
              <h4 className="text-[13px] font-medium capitalize text-zinc-300">
                {t.mediaHealth.playbackPlan(browser)}
              </h4>
              <dl className="mt-3 grid grid-cols-4 gap-4">
                {Object.entries(data.playback[browser]).map(([mode, count]) => (
                  <div key={mode}>
                    <dt className="truncate text-xs text-zinc-500">
                      {MODE_LABELS[mode as keyof typeof MODE_LABELS]}
                    </dt>
                    <dd className="mt-0.5 text-[13px] font-medium text-zinc-100">{count}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        id="health-codecs"
        title={t.mediaHealth.codecDistribution}
        icon={Film}
        width="full"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            { title: t.mediaHealth.videoCodec, items: data.codecs.video },
            { title: t.mediaHealth.audioCodec, items: data.codecs.audio },
            { title: t.mediaHealth.container, items: data.codecs.containers },
          ].map((group) => (
            <div key={group.title}>
              <h4 className="mb-3 text-[13px] font-medium text-zinc-300">{group.title}</h4>
              <Distribution items={group.items} />
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        id="health-runtime"
        title={t.mediaHealth.hlsStatus}
        icon={Server}
        width="full"
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-6">
          <SettingsMetric
            label={t.mediaHealth.activeJobs}
            value={`${hls.activeJobs}/${hls.maxActiveJobs}`}
          />
          <SettingsMetric label={t.mediaHealth.queueLabel} value={hls.queuedJobs} />
          <SettingsMetric label={t.mediaHealth.cacheLabel} value={formatBytes(hls.cacheBytes)} />
          <SettingsMetric label={t.mediaHealth.cacheEntries} value={hls.cacheEntries} />
          <SettingsMetric label={t.mediaHealth.quotaLabel} value={formatBytes(hls.maxCacheBytes)} />
          <SettingsMetric
            label={t.mediaHealth.liveTranscode}
            value={`${transcode.activeSessions}/${transcode.maxActiveSessions}`}
            hint={t.mediaHealth.liveTranscodeHint}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        id="health-jobs"
        title={t.mediaHealth.activeHlsJobs}
        description={t.mediaHealth.activeHlsJobsHint}
        icon={Server}
        width="full"
        action={
          <SettingsStatus tone={hls.jobs.length > 0 ? 'ok' : 'neutral'}>
            {t.mediaHealth.jobCount(hls.jobs.length)}
          </SettingsStatus>
        }
      >
        {hls.jobs.length === 0 ? (
          <p className="text-[13px] text-zinc-500">{t.mediaHealth.noActiveJobs}</p>
        ) : (
          <div className="overflow-x-auto border-y border-zinc-800/60">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-zinc-800/60 text-xs font-medium text-zinc-500">
                  <th className="py-2.5 pr-4">{t.mediaHealth.columnMedia}</th>
                  <th className="py-2.5 pr-4">{t.mediaHealth.columnPid}</th>
                  <th className="py-2.5 pr-4">{t.mediaHealth.columnStart}</th>
                  <th className="py-2.5 pr-4">{t.mediaHealth.columnProfile}</th>
                  <th className="py-2.5 pr-4">{t.mediaHealth.columnViewer}</th>
                  <th className="py-2.5 pr-4">{t.mediaHealth.columnLastAccess}</th>
                  <th className="py-2.5 pl-4 text-right">{t.mediaHealth.columnAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {hls.jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="max-w-xs py-3 pr-4">
                      <p className="truncate text-[13px] text-zinc-200" title={job.mediaName}>
                        {job.mediaName}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-zinc-600">{job.id.slice(0, 8)}</p>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-zinc-400">
                      {job.pid ?? t.mediaHealth.pidPending}
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-400">
                      {job.startSeconds
                        ? t.mediaHealth.startSeconds(job.startSeconds)
                        : t.mediaHealth.fromBeginning}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      <p className="text-zinc-300">
                        {job.profile === 'video-copy-aac'
                          ? t.mediaHealth.profileVideoCopy
                          : t.mediaHealth.profileFullEncode}
                      </p>
                      <p className="mt-0.5 text-zinc-500">
                        {job.isPaused ? t.mediaHealth.paused : t.mediaHealth.producing} ·{' '}
                        {t.mediaHealth.bufferLead(job.bufferLeadSeconds)}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-xs text-zinc-400">{job.viewerCount}</td>
                    <td className="py-3 pr-4 text-xs text-zinc-400">
                      {new Date(job.lastAccessAt).toLocaleTimeString('tr-TR')}
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <SettingsButton
                        variant="danger"
                        icon={Square}
                        onClick={() => stopHlsJob.mutate(job.id)}
                        isLoading={stopHlsJob.isPending && stopHlsJob.variables === job.id}
                        aria-label={t.mediaHealth.stopJob(job.mediaName)}
                      >
                        {t.mediaHealth.stop}
                      </SettingsButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        id="health-queue"
        title={t.mediaHealth.waitQueue}
        icon={Clock}
        width="full"
        action={
          hls.queue.length > 0 ? (
            <SettingsStatus tone="warning">
              {t.mediaHealth.waitingCount(hls.queue.length)}
            </SettingsStatus>
          ) : undefined
        }
      >
        {hls.queue.length === 0 ? (
          <p className="text-[13px] text-zinc-500">{t.mediaHealth.emptyQueue}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
            {hls.queue.map((item, index) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-600">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-zinc-200">{item.mediaName}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {item.priority === 'seek'
                      ? t.mediaHealth.prioritySeek
                      : t.mediaHealth.priorityNormal}{' '}
                    · {t.mediaHealth.waitSeconds(Math.round(item.waitMs / 1000))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        id="health-telemetry"
        title={t.mediaHealth.playbackQuality}
        icon={Activity}
        width="full"
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-6">
          <SettingsMetric
            label={t.mediaHealth.firstFrame}
            value={t.mediaHealth.milliseconds(playerTelemetry.firstFrameAverageMs)}
          />
          <SettingsMetric label={t.mediaHealth.stallCount} value={playerTelemetry.stallCount} />
          <SettingsMetric
            label={t.mediaHealth.stallAverage}
            value={t.mediaHealth.milliseconds(playerTelemetry.stallAverageMs)}
          />
          <SettingsMetric
            label={t.mediaHealth.seekRecovery}
            value={t.mediaHealth.milliseconds(playerTelemetry.seekRecoveryAverageMs)}
          />
          <SettingsMetric
            label={t.mediaHealth.errorCount}
            value={
              <span className={playerTelemetry.errorCount > 0 ? 'text-rose-400' : undefined}>
                {playerTelemetry.errorCount}
              </span>
            }
          />
          <SettingsMetric label={t.mediaHealth.sample} value={playerTelemetry.sampleCount} />
        </div>
      </SettingsCard>

      {data.failures.length > 0 ? (
        <SettingsCard
          id="health-failures"
          title={t.mediaHealth.analysisErrors}
          icon={AlertTriangle}
          tone="danger"
          width="full"
          action={
            <SettingsStatus tone="warning">
              {t.mediaHealth.failureCount(data.failures.length)}
            </SettingsStatus>
          }
        >
          <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
            {data.failures.map((failure) => (
              <li key={failure.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-zinc-200">{failure.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {failure.libraryName} · {failure.error}
                  </p>
                </div>
                <SettingsButton
                  variant="secondary"
                  icon={RotateCw}
                  onClick={() => reanalyze.mutate(failure.id)}
                  isLoading={reanalyze.isPending && reanalyze.variables === failure.id}
                  aria-label={t.mediaHealth.reanalyze(failure.name)}
                >
                  {t.mediaHealth.reanalyzeAction}
                </SettingsButton>
              </li>
            ))}
          </ul>
        </SettingsCard>
      ) : null}
    </div>
  );
};

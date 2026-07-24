import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MediaHealthDto } from '@cinedrive/shared';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Server,
} from 'lucide-react';
import { apiClient } from '../api/client';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

const modeLabels = {
  direct: 'Doğrudan',
  audio: 'Ses uyumu',
  hls: 'HLS',
  full: 'Tam dönüşüm',
};

const Distribution = ({
  title,
  items,
}: {
  title: string;
  items: Array<{ name: string; count: number }>;
}) => {
  const maximum = Math.max(...items.map((item) => item.count), 1);
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">
        {title}
      </h2>
      <div className="space-y-3">
        {items.slice(0, 8).map((item) => (
          <div key={item.name}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-semibold uppercase text-zinc-300">{item.name}</span>
              <span className="text-zinc-500">{item.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${(item.count / maximum) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export const MediaHealthPage: React.FC = () => {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<MediaHealthDto>({
    queryKey: ['media-health'],
    queryFn: async () => {
      const response = await apiClient.get<MediaHealthDto>('/insights/media-health');
      return response.data;
    },
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center gap-3 text-zinc-400">
        <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
        Medya sağlığı hesaplanıyor…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">
        Medya sağlığı bilgileri alınamadı.
      </div>
    );
  }

  const analyzedPercent = data.totalVideos
    ? Math.round((data.analyzedVideos / data.totalVideos) * 100)
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-extrabold text-white md:text-3xl">
            <Activity className="h-8 w-8 text-brand-400" />
            Medya Sağlığı
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Codec uyumluluğu, analiz hataları ve canlı transcode kaynakları.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Toplam Video', data.totalVideos, Database, 'text-sky-400'],
          ['Analiz Tamamlandı', `${analyzedPercent}%`, CheckCircle2, 'text-emerald-400'],
          ['Analiz Bekliyor', data.pendingVideos, Activity, 'text-amber-400'],
          ['Hatalı Dosya', data.failedVideos, AlertTriangle, 'text-red-400'],
        ].map(([label, value, Icon, color]) => (
          <div key={String(label)} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {String(label)}
              </span>
              {React.createElement(Icon as typeof Activity, {
                className: `h-5 w-5 ${String(color)}`,
              })}
            </div>
            <p className="mt-3 text-3xl font-black text-white">{String(value)}</p>
          </div>
        ))}
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        {(['safari', 'chromium'] as const).map((browser) => (
          <div key={browser} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-4 font-bold capitalize text-white">{browser} oynatma planı</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(data.playback[browser]).map(([mode, count]) => (
                <div key={mode} className="rounded-xl bg-zinc-950 p-3">
                  <p className="text-xs text-zinc-500">
                    {modeLabels[mode as keyof typeof modeLabels]}
                  </p>
                  <p className="mt-1 text-xl font-bold text-zinc-100">{count}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Distribution title="Video codec" items={data.codecs.video} />
        <Distribution title="Ses codec" items={data.codecs.audio} />
        <Distribution title="Container" items={data.codecs.containers} />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="flex items-center gap-2 font-bold text-white">
            <Server className="h-5 w-5 text-brand-400" /> HLS çalışma durumu
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <p className="rounded-xl bg-zinc-950 p-3 text-zinc-400">Aktif işler <strong className="float-right text-white">{data.runtime.hls.activeJobs}/{data.runtime.hls.maxActiveJobs}</strong></p>
            <p className="rounded-xl bg-zinc-950 p-3 text-zinc-400">Cache <strong className="float-right text-white">{formatBytes(data.runtime.hls.cacheBytes)}</strong></p>
            <p className="rounded-xl bg-zinc-950 p-3 text-zinc-400">Cache girdisi <strong className="float-right text-white">{data.runtime.hls.cacheEntries}</strong></p>
            <p className="rounded-xl bg-zinc-950 p-3 text-zinc-400">Kota <strong className="float-right text-white">{formatBytes(data.runtime.hls.maxCacheBytes)}</strong></p>
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="flex items-center gap-2 font-bold text-white">
            <Activity className="h-5 w-5 text-sky-400" /> Canlı transcode
          </h2>
          <p className="mt-6 text-4xl font-black text-white">
            {data.runtime.transcode.activeSessions}
            <span className="text-lg font-medium text-zinc-500">
              {' '}/ {data.runtime.transcode.maxActiveSessions}
            </span>
          </p>
          <p className="mt-2 text-sm text-zinc-500">Aktif audio/full uyumluluk oturumları</p>
        </div>
      </section>

      {data.failures.length > 0 ? (
        <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-bold text-red-200">
            <AlertTriangle className="h-5 w-5" /> Analiz hataları
          </h2>
          <div className="divide-y divide-zinc-800">
            {data.failures.map((failure) => (
              <div key={failure.id} className="py-3">
                <p className="truncate text-sm font-semibold text-zinc-200">{failure.name}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {failure.libraryName} · {failure.error}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

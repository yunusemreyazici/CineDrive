import { Link } from 'react-router-dom';
import { useStudioHealth } from '../../../hooks/useMusicStudio';
import { ErrorState } from '../../common/ErrorState';
import { StudioPanel, StudioButton, useStudioAction } from './StudioControls';
import { t, intlLocale } from '../../../i18n';

export function StudioHealth({ owner }: { owner: string }) {
  const health = useStudioHealth(owner);
  const action = useStudioAction(owner);
  if (health.isError)
    return <ErrorState error={health.error} onRetry={() => void health.refetch()} />;
  if (!health.data) return <p>{t.studio.loading}</p>;
  const { quality, enrichment, scans, workers } = health.data;
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(intlLocale) : t.studio.unknown;
  const state = (value: string) =>
    t.studio.states[value as keyof typeof t.studio.states] ?? t.studio.unknown;
  return (
    <div className="space-y-6">
      <StudioPanel>
        <h2 className="text-xl font-bold">{t.studio.health}</h2>
        <p className="text-sm text-zinc-400">{t.studio.qualityHint}</p>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(quality).map(([key, count]) => (
            <div key={key} className="rounded-xl bg-white/5 p-4">
              <dt className="text-sm text-zinc-400">{t.studio[key as keyof typeof quality]}</dt>
              <dd className="mt-2 text-2xl font-bold">{count.toLocaleString(intlLocale)}</dd>
            </div>
          ))}
        </dl>
        <Link className="inline-block text-brand-300 underline" to="/music/maintenance">
          {t.studio.review}
        </Link>
      </StudioPanel>
      <StudioPanel>
        <h2 className="text-xl font-bold">{t.studio.jobs}</h2>
        {action.feedback}
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {(
            ['queued', 'processing', 'completed', 'notFound', 'failed', 'retryWaiting'] as const
          ).map((key) => (
            <div key={key}>
              <dt>{t.studio[key]}</dt>
              <dd className="text-xl font-semibold">{enrichment[key]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm">
          {t.studio.started}: {date(enrichment.lastJobStartedAt)} · {t.studio.finished}:{' '}
          {date(enrichment.lastJobCompletedAt)}
        </p>
        <p className="text-sm">
          HTTP 429: {enrichment.providerHttp429} · HTTP 5xx: {enrichment.providerHttp5xx}
        </p>
        <StudioButton
          disabled={action.busy || enrichment.job.status === 'running'}
          onClick={() =>
            void action.run({
              path: '/music/maintenance/languages/enrich',
              body: { maxTracks: 200 },
            })
          }
        >
          {t.studio.pilot}
        </StudioButton>
        <p className="text-sm text-zinc-400">{t.studio.pilotHint}</p>
        <p className="text-sm text-zinc-400">{t.studio.unavailableControl}</p>
      </StudioPanel>
      <StudioPanel>
        <h2 className="text-xl font-bold">{t.studio.scan}</h2>
        {!scans.length && <p>{t.studio.empty}</p>}
        {scans.map((scan) => (
          <div key={scan.id} className="border-t border-white/10 py-3">
            <p>
              {scan.libraryName} · {state(scan.status)}
            </p>
            <p className="text-sm text-zinc-400">
              {date(scan.startedAt)} → {date(scan.completedAt)} · +{scan.addedCount} / −
              {scan.deletedCount} · {t.studio.failed}: {scan.errorCount}
            </p>
          </div>
        ))}
      </StudioPanel>
      {workers && (
        <StudioPanel>
          <h2 className="text-xl font-bold">{t.studio.worker}</h2>
          {Object.entries(workers).map(([name, job]) => (
            <div key={name}>
              <h3>
                {name === 'lyrics' ? t.studio.lyrics : t.studio.index} · {state(job.status)}
              </h3>
              <p className="text-sm text-zinc-400">
                {t.studio.started}: {date(job.startedAt)} · {t.studio.next}: {date(job.nextRunAt)} ·{' '}
                {t.studio.failed}: {job.failures}
              </p>
            </div>
          ))}
        </StudioPanel>
      )}
    </div>
  );
}

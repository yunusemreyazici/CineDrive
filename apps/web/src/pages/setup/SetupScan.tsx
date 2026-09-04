import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { DriveScanSourceDto, LibraryDto } from '@cinedrive/shared';
import { apiClient } from '../../api/client';
import { useScanLibraryMutation, useScanDriveSourceMutation } from '../../hooks/useApi';
import type { LibraryScanType } from '../../types/media';
import { SettingsButton } from '../settings/SettingsCard';
import { copy as c } from './copy';

export function SetupScan({ library, sourceId }: { library: LibraryDto; sourceId?: string }) {
  const [error, setError] = useState(false);
  const localScan = useScanLibraryMutation();
  const driveScan = useScanDriveSourceMutation();
  const scans = useQuery({
    queryKey: ['setupScan', library.id, sourceId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ scans: LibraryScanType[] }>(
        `/libraries/${library.id}/scans`,
      );
      const latest = data.scans.find((scan) => !sourceId || scan.driveScanSourceId === sourceId);
      if (latest || !sourceId) return latest ?? null;
      // Library history is capped at 20 entries. An older source's saved summary
      // must not be mistaken for a source that has never been scanned.
      const sources = await apiClient.get<{ sources: DriveScanSourceDto[] }>(
        `/libraries/${library.id}/drive-sources`,
      );
      return sources.data.sources.find((source) => source.id === sourceId)?.lastScan ?? null;
    },
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  });
  const scan = scans.data;
  const busy = localScan.isPending || driveScan.isPending || scan?.status === 'running';
  async function start() {
    setError(false);
    try {
      if (sourceId) await driveScan.mutateAsync({ libraryId: library.id, sourceId });
      else await localScan.mutateAsync(library.id);
    } catch {
      setError(true);
    }
    // Also refresh after a lost response: the server may have registered the scan.
    await scans.refetch();
  }
  if (scans.isPending) return <p role="status">{c.busy}</p>;
  if (scans.isError)
    return (
      <div role="alert">
        {c.loadError}{' '}
        <SettingsButton onClick={() => void scans.refetch()}>{c.refresh}</SettingsButton>
      </div>
    );
  const title = !scan
    ? c.waiting
    : scan.status === 'running'
      ? c.running
      : scan.status === 'completed'
        ? c.completed
        : c.failed;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold text-white">{library.name}</h2>
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-5"
      >
        <h3 className="font-semibold text-brand-300">{title}</h3>
        <p className="mt-2 text-sm text-zinc-400">
          {scan ? c.counts(scan.addedCount, scan.updatedCount, scan.errorCount) : c.waitHint}
        </p>
        {scan?.status === 'completed' && scan.addedCount === 0 && scan.updatedCount === 0 && (
          <p className="mt-3 text-sm">{c.empty}</p>
        )}
        {!!scan?.errorCount && <p className="mt-3 text-sm text-amber-300">{c.warnings}</p>}
      </div>
      <p className="text-sm text-zinc-400">{c.progressHint}</p>
      {error && (
        <p role="alert" className="text-rose-300">
          {c.scanError}
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        <SettingsButton
          disabled={busy}
          isLoading={localScan.isPending || driveScan.isPending}
          onClick={() => void start()}
        >
          {scan ? c.retry : c.start}
        </SettingsButton>
        <Link className="self-center text-brand-300 underline" to="/library">
          {c.browse}
        </Link>
        <Link className="self-center text-brand-300 underline" to="/music">
          {c.music}
        </Link>
      </div>
    </div>
  );
}

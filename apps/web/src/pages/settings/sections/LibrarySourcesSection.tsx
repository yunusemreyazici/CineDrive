import React from 'react';
import { AlertTriangle, Clock, Files, FolderSync, LibraryBig, RefreshCw } from 'lucide-react';
import { useDriveScanSourcesQuery, useLibrariesQuery } from '../../../hooks/useApi';
import { t } from '../../../i18n';
import { GoogleDriveSection } from './GoogleDriveSection';
import { LibrarySourceManagerSection } from './LibrarySourceManagerSection';

interface SourceSummaryProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}

const SourceSummary: React.FC<SourceSummaryProps> = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/50 px-4 py-3">
    <span className="rounded-lg bg-zinc-900 p-2 text-zinc-500">
      <Icon className="h-4 w-4" />
    </span>
    <div>
      <p className="text-lg font-semibold leading-none text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{label}</p>
    </div>
  </div>
);

/** One workflow for every location CineDrive can scan. */
export const LibrarySourcesSection: React.FC = () => {
  const { data: libraries = [] } = useLibrariesQuery();
  const driveLibrary = libraries.find((library) => library.storageType === 'gdrive');
  const { data: driveSources = [] } = useDriveScanSourcesQuery(driveLibrary?.id);
  const localLibraries = libraries.filter((library) => library.storageType === 'local');
  const allScanSummaries = [
    ...driveSources.map((source) => source.lastScan),
    ...localLibraries.map((library) => library.lastScan),
  ].filter(Boolean);
  const lastScanTimestamp = allScanSummaries
    .flatMap((scan) =>
      scan?.completedAt || scan?.startedAt ? [scan.completedAt || scan.startedAt] : [],
    )
    .sort((left, right) => new Date(right!).getTime() - new Date(left!).getTime())[0];
  const lastScanLabel = lastScanTimestamp
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(lastScanTimestamp),
      )
    : t.settings.librarySources.neverScanned;
  const activeSourceCount = driveSources.length + localLibraries.length;
  const totalFileCount =
    driveSources.reduce((total, source) => total + source.fileCount, 0) +
    localLibraries.reduce((total, library) => total + (library.fileCount || 0), 0);
  const accessIssueCount = allScanSummaries.filter(
    (scan) => scan?.status === 'failed' || (scan?.errorCount || 0) > 0,
  ).length;
  const runningScanCount = allScanSummaries.filter((scan) => scan?.status === 'running').length;

  return (
    <>
      <section aria-labelledby="library-sources-title" className="pb-7 pt-1">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-2.5 text-brand-400">
            <LibraryBig className="h-5 w-5" />
          </span>
          <div>
            <h2
              id="library-sources-title"
              className="font-display text-lg font-semibold text-white"
            >
              {t.settings.librarySources.title}
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
              {t.settings.librarySources.description}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <SourceSummary
            icon={FolderSync}
            label={t.settings.librarySources.activeSources}
            value={activeSourceCount}
          />
          <SourceSummary
            icon={Files}
            label={t.settings.librarySources.totalFiles}
            value={totalFileCount}
          />
          <SourceSummary
            icon={Clock}
            label={t.settings.librarySources.lastScan}
            value={<span className="text-sm">{lastScanLabel}</span>}
          />
          <SourceSummary
            icon={AlertTriangle}
            label={t.settings.librarySources.accessIssues}
            value={accessIssueCount}
          />
          <SourceSummary
            icon={RefreshCw}
            label={t.settings.librarySources.runningScans}
            value={runningScanCount}
          />
        </div>
      </section>

      <GoogleDriveSection driveSources={driveSources} />
      <LibrarySourceManagerSection />
    </>
  );
};

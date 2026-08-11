import React from 'react';
import { Cloud, FolderSync, HardDrive, LibraryBig } from 'lucide-react';
import { useDriveScanSourcesQuery, useLibrariesQuery } from '../../../hooks/useApi';
import { t } from '../../../i18n';
import { useGoogleConnections } from '../useGoogleConnections';
import { GoogleDriveSection } from './GoogleDriveSection';
import { LibraryScanSection } from './LibraryScanSection';
import { LocalLibrarySection } from './LocalLibrarySection';
import { LibraryVisibilitySection } from './AppearanceSection';
import { DatabaseSection, DatabaseStatsSection } from './DatabaseSection';

interface SourceSummaryProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
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
  const connections = useGoogleConnections();
  const driveLibrary = libraries.find((library) => library.storageType === 'gdrive');
  const { data: driveSources = [] } = useDriveScanSourcesQuery(driveLibrary?.id);
  const localLibraryCount = libraries.filter((library) => library.storageType === 'local').length;

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

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SourceSummary
            icon={Cloud}
            label={t.settings.librarySources.googleAccounts}
            value={connections.length}
          />
          <SourceSummary
            icon={FolderSync}
            label={t.settings.librarySources.driveSources}
            value={driveSources.length}
          />
          <SourceSummary
            icon={HardDrive}
            label={t.settings.librarySources.localLibraries}
            value={localLibraryCount}
          />
        </div>
      </section>

      <GoogleDriveSection driveSources={driveSources} />
      <LibraryScanSection />
      <LocalLibrarySection />
      <LibraryVisibilitySection />
      <DatabaseStatsSection />
      <DatabaseSection />
    </>
  );
};

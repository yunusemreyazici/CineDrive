import React from 'react';
import { InsightsPage } from './InsightsPage';
import { MediaHealthPage } from './MediaHealthPage';
import { DatabaseStatsSection } from './settings/sections/DatabaseSection';
import { SystemMetricsPanel } from './SystemMetricsPanel';
import { useSessionQuery } from '../hooks/useApi';

/** Storage usage, database maintenance and playback health share one workspace. */
export const StorageHealthPage: React.FC = () => {
  const { data: session } = useSessionQuery();
  return (
    <div className="pb-8">
      {session?.user?.role === 'admin' && <SystemMetricsPanel />}
      <DatabaseStatsSection />
      <InsightsPage />
      <MediaHealthPage />
    </div>
  );
};

import React from 'react';
import { InsightsPage } from './InsightsPage';
import { MediaHealthPage } from './MediaHealthPage';
import { DatabaseStatsSection } from './settings/sections/DatabaseSection';

/** Storage usage, database maintenance and playback health share one workspace. */
export const StorageHealthPage: React.FC = () => (
  <div className="pb-8">
    <DatabaseStatsSection />
    <InsightsPage />
    <MediaHealthPage />
  </div>
);

import React from 'react';
import { ProfileSection } from './sections/ProfileSection';
import { SecuritySection } from './sections/SecuritySection';
import {
  AppearanceSection,
  LanguageSection,
  LibraryVisibilitySection,
} from './sections/AppearanceSection';
import { GoogleDriveSection } from './sections/GoogleDriveSection';
import { LibraryScanSection } from './sections/LibraryScanSection';
import { LocalLibrarySection } from './sections/LocalLibrarySection';
import { OpenSubtitlesSection } from './sections/OpenSubtitlesSection';
import { DatabaseSection, DatabaseStatsSection } from './sections/DatabaseSection';
import { AboutSection } from './sections/AboutSection';

/**
 * Sections carry their own top hairline and vertical rhythm, so this is a plain
 * column — the gap that used to separate ten bordered cards would now double
 * the space between two rules.
 */
export const GeneralSettingsTab: React.FC = () => (
  <div>
    <ProfileSection />
    <SecuritySection />
    <AppearanceSection />
    <LanguageSection />
    <LibraryVisibilitySection />
    <GoogleDriveSection />
    <LibraryScanSection />
    <LocalLibrarySection />
    <OpenSubtitlesSection />
    <DatabaseStatsSection />
    <DatabaseSection />
    <AboutSection />
  </div>
);

import React from 'react';
import { ProfileSection } from './sections/ProfileSection';
import { SecuritySection } from './sections/SecuritySection';
import { AppearanceSection, LibraryVisibilitySection } from './sections/AppearanceSection';
import { GoogleDriveSection } from './sections/GoogleDriveSection';
import { LibraryScanSection } from './sections/LibraryScanSection';
import { LocalLibrarySection } from './sections/LocalLibrarySection';
import { OpenSubtitlesSection } from './sections/OpenSubtitlesSection';
import { DatabaseSection } from './sections/DatabaseSection';
import { AboutSection } from './sections/AboutSection';

export const GeneralSettingsTab: React.FC = () => (
  <div className="grid grid-cols-1 gap-4">
    <ProfileSection />
    <SecuritySection />
    <AppearanceSection />
    <LibraryVisibilitySection />
    <GoogleDriveSection />
    <LibraryScanSection />
    <LocalLibrarySection />
    <OpenSubtitlesSection />
    <DatabaseSection />
    <AboutSection />
  </div>
);

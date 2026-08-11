import React from 'react';
import { AppearanceSection, LanguageSection } from './AppearanceSection';
import { AboutSection } from './AboutSection';

/** Appearance, locale and application information share one compact pane. */
export const InterfaceSection: React.FC = () => (
  <>
    <AppearanceSection />
    <LanguageSection />
    <AboutSection />
  </>
);

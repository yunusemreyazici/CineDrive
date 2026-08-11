import React from 'react';
import { AppearanceSection, LanguageSection } from './AppearanceSection';

/** Appearance and locale share one compact pane. */
export const InterfaceSection: React.FC = () => (
  <>
    <AppearanceSection />
    <LanguageSection />
  </>
);

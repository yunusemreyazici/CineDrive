import type React from 'react';
import { Settings, Database, HardDrive, Activity } from 'lucide-react';
import { t } from '../../i18n';

export type SettingsTab = 'general' | 'manage' | 'storage' | 'health';

export interface SettingsTabDefinition {
  id: SettingsTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  { id: 'general', ...t.settings.tabs.general, icon: Settings },
  { id: 'manage', ...t.settings.tabs.manage, icon: Database },
  { id: 'storage', ...t.settings.tabs.storage, icon: HardDrive },
  { id: 'health', ...t.settings.tabs.health, icon: Activity },
];

export interface SettingsSearchItem {
  label: string;
  description: string;
  tab: SettingsTab;
  /** Matches the `id` of the corresponding SettingsCard. */
  targetId?: string;
}

export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  { ...t.settings.search.profile, tab: 'general', targetId: 'settings-profile' },
  { ...t.settings.search.security, tab: 'general', targetId: 'settings-security' },
  { ...t.settings.search.appearance, tab: 'general', targetId: 'settings-appearance' },
  { ...t.settings.search.visibility, tab: 'general', targetId: 'settings-visibility' },
  { ...t.settings.search.google, tab: 'general', targetId: 'settings-google' },
  { ...t.settings.search.scan, tab: 'general', targetId: 'settings-scan' },
  { ...t.settings.search.localLibrary, tab: 'general', targetId: 'settings-local-library' },
  { ...t.settings.search.openSubtitles, tab: 'general', targetId: 'settings-opensubtitles' },
  { ...t.settings.search.database, tab: 'general', targetId: 'settings-database' },
  { ...t.settings.search.about, tab: 'general', targetId: 'settings-about' },
  { ...t.settings.search.manage, tab: 'manage' },
  { ...t.settings.search.storage, tab: 'storage' },
  { ...t.settings.search.health, tab: 'health' },
];

export const isSettingsTab = (value: string | null): value is SettingsTab =>
  SETTINGS_TABS.some((tab) => tab.id === value);

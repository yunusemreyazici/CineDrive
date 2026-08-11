import type React from 'react';
import { Database, FolderTree, HardDrive, Info, KeyRound, Palette, User } from 'lucide-react';
import { t } from '../../i18n';

/**
 * One pane per destination.
 *
 * The rail used to carry four entries while "General" alone stacked twelve
 * unrelated sections — profile, password, theme, language, visibility, Drive
 * accounts, scanning, local folders, subtitles, database stats, database
 * clearing and about — into a single scroll. The settings search existed to
 * compensate for that; it is now a shortcut rather than the only way through.
 */
export type SettingsPane =
  'profile' | 'appearance' | 'about' | 'libraries' | 'api' | 'manage' | 'storage';

export interface SettingsPaneDefinition {
  id: SettingsPane;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface SettingsGroup {
  id: string;
  label: string;
  panes: SettingsPaneDefinition[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'account',
    label: t.settings.groups.account,
    panes: [{ id: 'profile', label: t.settings.search.profile.label, icon: User }],
  },
  {
    id: 'interface',
    label: t.settings.groups.interface,
    panes: [
      { id: 'appearance', label: t.settings.search.appearance.label, icon: Palette },
      { id: 'about', label: t.settings.search.about.label, icon: Info },
    ],
  },
  {
    id: 'libraries',
    label: t.settings.groups.libraries,
    panes: [
      { id: 'libraries', label: t.settings.search.librarySources.label, icon: FolderTree },
      { id: 'api', label: t.settings.search.apiManagement.label, icon: KeyRound },
    ],
  },
  {
    id: 'maintenance',
    label: t.settings.groups.maintenance,
    panes: [
      { id: 'manage', label: t.settings.search.manage.label, icon: Database },
      { id: 'storage', label: t.settings.search.storage.label, icon: HardDrive },
    ],
  },
];

const ALL_PANES = SETTINGS_GROUPS.flatMap((group) => group.panes);

export const DEFAULT_PANE: SettingsPane = 'profile';

export const isSettingsPane = (value: string | null): value is SettingsPane =>
  ALL_PANES.some((pane) => pane.id === value);

/**
 * `?tab=general` links predate the split. They still resolve — to the pane the
 * old tab used to open on.
 */
const LEGACY_TABS: Record<string, SettingsPane> = {
  general: 'profile',
  security: 'profile',
  google: 'libraries',
  scan: 'libraries',
  localLibrary: 'libraries',
  language: 'appearance',
  about: 'about',
  openSubtitles: 'api',
  visibility: 'manage',
  database: 'manage',
  manage: 'manage',
  storage: 'storage',
  health: 'storage',
};

export const resolvePane = (value: string | null): SettingsPane => {
  if (isSettingsPane(value)) return value;
  if (value && LEGACY_TABS[value]) return LEGACY_TABS[value];
  return DEFAULT_PANE;
};

export interface SettingsSearchItem {
  label: string;
  description: string;
  pane: SettingsPane;
}

export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  { ...t.settings.search.profile, pane: 'profile' },
  { ...t.settings.search.security, pane: 'profile' },
  { ...t.settings.search.appearance, pane: 'appearance' },
  { ...t.settings.search.language, pane: 'appearance' },
  { ...t.settings.search.librarySources, pane: 'libraries' },
  { ...t.settings.search.apiManagement, pane: 'api' },
  { ...t.settings.search.manage, pane: 'manage' },
  { ...t.settings.search.storage, pane: 'storage' },
  { ...t.settings.search.health, pane: 'storage' },
  { ...t.settings.search.about, pane: 'about' },
];

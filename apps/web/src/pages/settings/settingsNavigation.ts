import type React from 'react';
import {
  Activity,
  Captions,
  Database,
  EyeOff,
  FolderTree,
  HardDrive,
  Info,
  Languages,
  Lock,
  Palette,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';
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
  | 'profile'
  | 'security'
  | 'appearance'
  | 'language'
  | 'visibility'
  | 'google'
  | 'scan'
  | 'localLibrary'
  | 'openSubtitles'
  | 'manage'
  | 'storage'
  | 'health'
  | 'database'
  | 'about';

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
    panes: [
      { id: 'profile', label: t.settings.search.profile.label, icon: User },
      { id: 'security', label: t.settings.search.security.label, icon: Lock },
    ],
  },
  {
    id: 'interface',
    label: t.settings.groups.interface,
    panes: [
      { id: 'appearance', label: t.settings.search.appearance.label, icon: Palette },
      { id: 'language', label: t.settings.search.language.label, icon: Languages },
      { id: 'visibility', label: t.settings.search.visibility.label, icon: EyeOff },
    ],
  },
  {
    id: 'libraries',
    label: t.settings.groups.libraries,
    panes: [
      { id: 'google', label: t.settings.search.google.label, icon: ShieldCheck },
      { id: 'scan', label: t.settings.search.scan.label, icon: RefreshCw },
      { id: 'localLibrary', label: t.settings.search.localLibrary.label, icon: FolderTree },
      { id: 'openSubtitles', label: t.settings.search.openSubtitles.label, icon: Captions },
    ],
  },
  {
    id: 'maintenance',
    label: t.settings.groups.maintenance,
    panes: [
      { id: 'manage', label: t.settings.search.manage.label, icon: Database },
      { id: 'storage', label: t.settings.search.storage.label, icon: HardDrive },
      { id: 'health', label: t.settings.search.health.label, icon: Activity },
      { id: 'database', label: t.settings.search.database.label, icon: Database },
    ],
  },
  {
    id: 'other',
    label: t.settings.groups.other,
    panes: [{ id: 'about', label: t.settings.search.about.label, icon: Info }],
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
  manage: 'manage',
  storage: 'storage',
  health: 'health',
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
  { ...t.settings.search.security, pane: 'security' },
  { ...t.settings.search.appearance, pane: 'appearance' },
  { ...t.settings.search.language, pane: 'language' },
  { ...t.settings.search.visibility, pane: 'visibility' },
  { ...t.settings.search.google, pane: 'google' },
  { ...t.settings.search.scan, pane: 'scan' },
  { ...t.settings.search.localLibrary, pane: 'localLibrary' },
  { ...t.settings.search.openSubtitles, pane: 'openSubtitles' },
  { ...t.settings.search.manage, pane: 'manage' },
  { ...t.settings.search.storage, pane: 'storage' },
  { ...t.settings.search.health, pane: 'health' },
  { ...t.settings.search.database, pane: 'database' },
  { ...t.settings.search.about, pane: 'about' },
];

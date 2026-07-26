import React from 'react';
import { Palette, EyeOff, Languages } from 'lucide-react';
import { useUiStore, type ThemeType } from '../../../stores/useUiStore';
import {
  SettingsCard,
  SettingsChoice,
  SettingsField,
  SettingsRow,
  SettingsToggle,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';
import { LOCALES, locale, setLocale, t, type Locale } from '../../../i18n';

/**
 * `OLED Midnight` used to sit second here. Its brand ramp was within a couple
 * of degrees of the default cyan, so the two were indistinguishable in every
 * control — it only changed the page background.
 */
const THEMES: Array<{ id: ThemeType; name: string; desc: string; accentClass: string }> = [
  { id: 'default', ...t.settings.appearance.themes.default, accentClass: 'bg-cyan-500' },
  { id: 'neon', ...t.settings.appearance.themes.neon, accentClass: 'bg-purple-500' },
  { id: 'emerald', ...t.settings.appearance.themes.emerald, accentClass: 'bg-emerald-500' },
  { id: 'amber', ...t.settings.appearance.themes.amber, accentClass: 'bg-amber-500' },
  { id: 'rose', ...t.settings.appearance.themes.rose, accentClass: 'bg-rose-500' },
  { id: 'azure', ...t.settings.appearance.themes.azure, accentClass: 'bg-blue-600' },
  { id: 'graphite', ...t.settings.appearance.themes.graphite, accentClass: 'bg-zinc-500' },
];

export const AppearanceSection: React.FC = () => {
  const { theme, setTheme } = useUiStore();

  return (
    <SettingsCard
      id="settings-appearance"
      title={t.settings.appearance.title}
      description={t.settings.appearance.description}
      icon={Palette}
      width="full"
    >
      <div
        role="radiogroup"
        aria-label={t.settings.appearance.groupLabel}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {THEMES.map((option) => (
          <SettingsChoice
            key={option.id}
            selected={theme === option.id}
            onSelect={() => setTheme(option.id)}
            title={option.name}
            description={option.desc}
            swatchClass={option.accentClass}
          />
        ))}
      </div>
    </SettingsCard>
  );
};

export const LanguageSection: React.FC = () => (
  <SettingsCard
    id="settings-language"
    title={t.settings.language.title}
    description={t.settings.language.description}
    icon={Languages}
  >
    <SettingsField
      id="settings-language-select"
      label={t.settings.language.label}
      hint={t.settings.language.reloadNotice}
    >
      <select
        id="settings-language-select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className={SETTINGS_INPUT_CLASSES}
      >
        {LOCALES.map((id) => (
          <option key={id} value={id}>
            {t.settings.language.names[id]}
          </option>
        ))}
      </select>
    </SettingsField>
  </SettingsCard>
);

export const LibraryVisibilitySection: React.FC = () => {
  const hideMoviesWithoutMetadata = useUiStore((state) => state.hideMoviesWithoutMetadata);
  const setHideMoviesWithoutMetadata = useUiStore((state) => state.setHideMoviesWithoutMetadata);

  return (
    <SettingsCard
      id="settings-visibility"
      title={t.settings.visibility.title}
      description={t.settings.visibility.description}
      icon={EyeOff}
    >
      <SettingsRow
        title={t.settings.visibility.hideWithoutMetadata}
        description={t.settings.visibility.hideWithoutMetadataHint}
      >
        <SettingsToggle
          checked={hideMoviesWithoutMetadata}
          onChange={setHideMoviesWithoutMetadata}
          label={t.settings.visibility.hideWithoutMetadata}
        />
      </SettingsRow>
    </SettingsCard>
  );
};

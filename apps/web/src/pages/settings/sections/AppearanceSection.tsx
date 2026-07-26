import React from 'react';
import { Palette, EyeOff } from 'lucide-react';
import { useUiStore, type ThemeType } from '../../../stores/useUiStore';
import { SettingsCard, SettingsChoice, SettingsRow, SettingsToggle } from '../SettingsCard';
import { t } from '../../../i18n';

const THEMES: Array<{ id: ThemeType; name: string; desc: string; accentClass: string }> = [
  { id: 'default', ...t.settings.appearance.themes.default, accentClass: 'bg-cyan-500' },
  { id: 'midnight', ...t.settings.appearance.themes.midnight, accentClass: 'bg-cyan-500' },
  { id: 'neon', ...t.settings.appearance.themes.neon, accentClass: 'bg-purple-500' },
  { id: 'emerald', ...t.settings.appearance.themes.emerald, accentClass: 'bg-emerald-500' },
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

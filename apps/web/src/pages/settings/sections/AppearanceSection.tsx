import React from 'react';
import { Palette, Check, EyeOff } from 'lucide-react';
import { useUiStore, type ThemeType } from '../../../stores/useUiStore';
import { SettingsCard } from '../SettingsCard';
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
      icon={
        <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-400">
          <Palette className="h-5 w-5" />
        </div>
      }
    >
      <div
        role="radiogroup"
        aria-label={t.settings.appearance.groupLabel}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4"
      >
        {THEMES.map((option) => {
          const isSelected = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setTheme(option.id)}
              className={`relative space-y-2 rounded-2xl border p-3 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                isSelected
                  ? 'border-brand-500 bg-zinc-900 shadow-lg ring-1 ring-brand-500'
                  : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-4 w-4 rounded-full ${option.accentClass}`} />
                  <span className="text-xs font-bold text-white">{option.name}</span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-brand-400" />}
              </div>
              <p className="text-[11px] text-zinc-400">{option.desc}</p>
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
};

export const LibraryVisibilitySection: React.FC = () => {
  const hideMoviesWithoutMetadata = useUiStore((state) => state.hideMoviesWithoutMetadata);
  const setHideMoviesWithoutMetadata = useUiStore(
    (state) => state.setHideMoviesWithoutMetadata,
  );

  return (
    <SettingsCard
      id="settings-visibility"
      title={t.settings.visibility.title}
      description={t.settings.visibility.description}
      icon={
        <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-400">
          <EyeOff className="h-5 w-5" />
        </div>
      }
    >
      <div className="flex items-center justify-between gap-5 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div>
          <p className="text-sm font-semibold text-zinc-100">
            {t.settings.visibility.hideWithoutMetadata}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {t.settings.visibility.hideWithoutMetadataHint}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hideMoviesWithoutMetadata}
          aria-label={t.settings.visibility.hideWithoutMetadata}
          onClick={() => setHideMoviesWithoutMetadata(!hideMoviesWithoutMetadata)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            hideMoviesWithoutMetadata
              ? 'border-brand-500 bg-brand-600'
              : 'border-zinc-700 bg-zinc-800'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              hideMoviesWithoutMetadata ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </SettingsCard>
  );
};

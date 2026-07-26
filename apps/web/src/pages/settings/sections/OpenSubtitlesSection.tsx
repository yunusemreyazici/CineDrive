import React, { useId, useState } from 'react';
import { Settings, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import {
  useOpenSubtitlesSettingsQuery,
  useUpdateOpenSubtitlesSettingsMutation,
} from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import { SettingsCard, SettingsField, SETTINGS_INPUT_CLASSES } from '../SettingsCard';
import { t } from '../../../i18n';

export const OpenSubtitlesSection: React.FC = () => {
  const fieldId = useId();
  const { data: openSubSettings, isLoading } = useOpenSubtitlesSettingsQuery();
  const updateSettings = useUpdateOpenSubtitlesSettingsMutation();

  const [apiKey, setApiKey] = useSyncedState(openSubSettings?.apiKey || '');
  const [username, setUsername] = useSyncedState(openSubSettings?.username || '');
  const [preferredLanguages, setPreferredLanguages] = useSyncedState(
    openSubSettings?.preferredLanguages || 'tr,en',
  );
  // Never re-seeded from the server: the API deliberately does not return it.
  const [password, setPassword] = useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate(
      {
        apiKey,
        username,
        ...(password ? { password } : {}),
        preferredLanguages,
      },
      {
        onSuccess: () => {
          toast.success(t.settings.openSubtitles.saved);
          setPassword('');
        },
        onError: (error) => toast.fromError(error, t.settings.openSubtitles.saveFailed),
      },
    );
  };

  return (
    <SettingsCard
      id="settings-opensubtitles"
      title={t.settings.openSubtitles.title}
      description={t.settings.openSubtitles.description}
      icon={
        <div className="rounded-xl bg-purple-500/10 p-2.5 text-purple-400">
          <Settings className="h-5 w-5" />
        </div>
      }
      action={
        openSubSettings?.hasApiKey ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {t.settings.openSubtitles.apiKeyActive}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {t.settings.openSubtitles.apiKeyMissing}
          </span>
        )
      }
    >
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-zinc-800/50" />
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <SettingsField
            id={`${fieldId}-key`}
            label={t.settings.openSubtitles.apiKey}
          >
            <input
              id={`${fieldId}-key`}
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t.settings.openSubtitles.apiKeyPlaceholder}
              className={`${SETTINGS_INPUT_CLASSES} font-mono`}
            />
          </SettingsField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SettingsField id={`${fieldId}-username`} label={t.settings.openSubtitles.username}>
              <input
                id={`${fieldId}-username`}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t.settings.openSubtitles.usernamePlaceholder}
                className={SETTINGS_INPUT_CLASSES}
              />
            </SettingsField>

            <SettingsField id={`${fieldId}-password`} label={t.settings.openSubtitles.password}>
              <input
                id={`${fieldId}-password`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={SETTINGS_INPUT_CLASSES}
              />
            </SettingsField>
          </div>

          <SettingsField id={`${fieldId}-languages`} label={t.settings.openSubtitles.languages}>
            <input
              id={`${fieldId}-languages`}
              type="text"
              value={preferredLanguages}
              onChange={(e) => setPreferredLanguages(e.target.value)}
              placeholder="tr,en"
              className={SETTINGS_INPUT_CLASSES}
            />
          </SettingsField>

          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 disabled:opacity-40"
          >
            {updateSettings.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t.common.saving}</span>
              </>
            ) : (
              <span>{t.settings.openSubtitles.saveSettings}</span>
            )}
          </button>
        </form>
      )}
    </SettingsCard>
  );
};

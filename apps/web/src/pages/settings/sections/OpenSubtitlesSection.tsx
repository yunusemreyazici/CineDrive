import React, { useId } from 'react';
import { Captions, AlertTriangle } from 'lucide-react';
import {
  useOpenSubtitlesSettingsQuery,
  useUpdateOpenSubtitlesSettingsMutation,
} from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import {
  SettingsButton,
  SettingsCard,
  SettingsField,
  SettingsStatus,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';
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
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate(
      {
        apiKey,
        username,
        preferredLanguages,
      },
      {
        onSuccess: () => toast.success(t.settings.openSubtitles.saved),
        onError: (error) => toast.fromError(error, t.settings.openSubtitles.saveFailed),
      },
    );
  };

  return (
    <SettingsCard
      id="settings-opensubtitles"
      title={t.settings.openSubtitles.title}
      description={t.settings.openSubtitles.description}
      icon={Captions}
      action={
        openSubSettings?.hasApiKey ? (
          <SettingsStatus tone="ok">{t.settings.openSubtitles.apiKeyActive}</SettingsStatus>
        ) : (
          <SettingsStatus tone="warning" icon={AlertTriangle}>
            {t.settings.openSubtitles.apiKeyMissing}
          </SettingsStatus>
        )
      }
    >
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-zinc-800/40" />
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

          <SettingsButton
            type="submit"
            isLoading={updateSettings.isPending}
            loadingLabel={t.common.saving}
          >
            {t.settings.openSubtitles.saveSettings}
          </SettingsButton>
        </form>
      )}
    </SettingsCard>
  );
};

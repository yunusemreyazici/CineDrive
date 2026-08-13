import React, { useId, useState } from 'react';
import { AlertTriangle, Captions, Clapperboard, KeyRound, Music2, Trash2 } from 'lucide-react';
import {
  type ApiKeySource,
  useApiSettingsQuery,
  useUpdateApiSettingsMutation,
} from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import {
  SettingsButton,
  SettingsCard,
  SettingsField,
  SettingsRow,
  SettingsStatus,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';
import { t } from '../../../i18n';

const sourceLabel = (source?: ApiKeySource) => {
  if (source === 'user') return t.settings.apiManagement.userKey;
  if (source === 'environment') return t.settings.apiManagement.environmentKey;
  return t.settings.apiManagement.missingKey;
};

const ProviderStatus: React.FC<{ source?: ApiKeySource }> = ({ source }) =>
  source && source !== 'none' ? (
    <SettingsStatus tone="ok">{sourceLabel(source)}</SettingsStatus>
  ) : (
    <SettingsStatus tone="warning" icon={AlertTriangle}>
      {sourceLabel(source)}
    </SettingsStatus>
  );

const ServiceStatus: React.FC<{ ready: boolean; disabledLabel?: string }> = ({
  ready,
  disabledLabel,
}) => (
  <SettingsStatus tone={ready ? 'ok' : 'warning'} icon={ready ? undefined : AlertTriangle}>
    {ready
      ? t.settings.apiManagement.ready
      : disabledLabel || t.settings.apiManagement.notConfigured}
  </SettingsStatus>
);

export const ApiManagementSection: React.FC = () => {
  const fieldId = useId();
  const { data: settings, isLoading } = useApiSettingsQuery();
  const updateSettings = useUpdateApiSettingsMutation();
  const [openSubtitlesKey, setOpenSubtitlesKey] = useState('');
  const [tmdbKey, setTmdbKey] = useState('');
  const [acoustIdKey, setAcoustIdKey] = useState('');
  const [username, setUsername] = useSyncedState(settings?.openSubtitles.username || '');
  const [preferredLanguages, setPreferredLanguages] = useSyncedState(
    settings?.openSubtitles.preferredLanguages || 'tr,en',
  );

  const saveOpenSubtitles = (event: React.FormEvent) => {
    event.preventDefault();
    updateSettings.mutate(
      {
        ...(openSubtitlesKey.trim() ? { openSubtitlesApiKey: openSubtitlesKey.trim() } : {}),
        openSubtitlesUsername: username,
        preferredLanguages,
      },
      {
        onSuccess: () => {
          setOpenSubtitlesKey('');
          toast.success(t.settings.apiManagement.openSubtitlesSaved);
        },
        onError: (error) => toast.fromError(error, t.settings.apiManagement.saveFailed),
      },
    );
  };

  const saveTmdb = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tmdbKey.trim()) return;
    updateSettings.mutate(
      { tmdbApiKey: tmdbKey.trim() },
      {
        onSuccess: () => {
          setTmdbKey('');
          toast.success(t.settings.apiManagement.tmdbSaved);
        },
        onError: (error) => toast.fromError(error, t.settings.apiManagement.saveFailed),
      },
    );
  };

  const saveAcoustId = (event: React.FormEvent) => {
    event.preventDefault();
    if (!acoustIdKey.trim()) return;
    updateSettings.mutate(
      { acoustidApiKey: acoustIdKey.trim() },
      {
        onSuccess: () => {
          setAcoustIdKey('');
          toast.success(t.settings.apiManagement.acoustIdSaved);
        },
        onError: (error) => toast.fromError(error, t.settings.apiManagement.saveFailed),
      },
    );
  };

  const clearKey = (provider: 'openSubtitles' | 'tmdb' | 'acoustId') => {
    updateSettings.mutate(
      provider === 'openSubtitles'
        ? { clearOpenSubtitlesApiKey: true }
        : provider === 'tmdb'
          ? { clearTmdbApiKey: true }
          : { clearAcoustidApiKey: true },
      {
        onSuccess: () => toast.success(t.settings.apiManagement.keyRemoved),
        onError: (error) => toast.fromError(error, t.settings.apiManagement.saveFailed),
      },
    );
  };

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-xl bg-zinc-900/50" />;
  }

  return (
    <div className="space-y-5 pb-8">
      <section className="flex items-start gap-3 pb-1">
        <span className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-2.5 text-brand-400">
          <KeyRound className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            {t.settings.apiManagement.title}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
            {t.settings.apiManagement.description}
          </p>
        </div>
      </section>

      <SettingsCard
        id="settings-api-music"
        title={t.settings.apiManagement.musicTitle}
        description={t.settings.apiManagement.musicDescription}
        icon={Music2}
        width="full"
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
          <form
            onSubmit={saveAcoustId}
            className="rounded-xl border border-zinc-800/70 bg-zinc-950/35 p-4"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h4 className="text-[13px] font-semibold text-zinc-100">AcoustID</h4>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {t.settings.apiManagement.acoustIdDescription}
                </p>
              </div>
              <ProviderStatus source={settings?.music.acoustId.source} />
            </div>
            <SettingsField
              id={`${fieldId}-acoustid-key`}
              label={t.settings.apiManagement.acoustIdApiKey}
              hint={t.settings.apiManagement.writeOnlyHint}
            >
              <input
                id={`${fieldId}-acoustid-key`}
                type="password"
                autoComplete="off"
                value={acoustIdKey}
                onChange={(event) => setAcoustIdKey(event.target.value)}
                placeholder={t.settings.apiManagement.keepExistingPlaceholder}
                className={`${SETTINGS_INPUT_CLASSES} font-mono`}
              />
            </SettingsField>
            <div className="mt-4 flex flex-wrap gap-2">
              <SettingsButton
                type="submit"
                disabled={!acoustIdKey.trim()}
                isLoading={updateSettings.isPending}
              >
                {t.settings.apiManagement.saveProvider}
              </SettingsButton>
              <SettingsButton
                type="button"
                variant="danger"
                icon={Trash2}
                disabled={settings?.music.acoustId.source !== 'user'}
                onClick={() => clearKey('acoustId')}
              >
                {t.settings.apiManagement.removeUserKey}
              </SettingsButton>
            </div>
          </form>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
              {t.settings.apiManagement.musicServicesTitle}
            </p>
            <SettingsRow
              title="MusicBrainz + Cover Art Archive"
              description={t.settings.apiManagement.musicBrainzDescription}
            >
              <ServiceStatus
                ready={Boolean(settings?.music.onlineMetadataEnabled)}
                disabledLabel={t.settings.apiManagement.disabled}
              />
            </SettingsRow>
            <SettingsRow
              title="Wikimedia Commons + Deezer"
              description={t.settings.apiManagement.artistArtworkDescription}
            >
              <ServiceStatus
                ready={Boolean(settings?.music.onlineMetadataEnabled)}
                disabledLabel={t.settings.apiManagement.disabled}
              />
            </SettingsRow>
            <SettingsRow title="LRCLIB" description={t.settings.apiManagement.lrclibDescription}>
              <ServiceStatus ready />
            </SettingsRow>
            <SettingsRow
              title="LibreTranslate"
              description={t.settings.apiManagement.libreTranslateDescription}
            >
              <ServiceStatus ready={Boolean(settings?.music.libreTranslateConfigured)} />
            </SettingsRow>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="settings-api-opensubtitles"
        title={t.settings.apiManagement.openSubtitlesTitle}
        description={t.settings.apiManagement.openSubtitlesDescription}
        icon={Captions}
        action={<ProviderStatus source={settings?.openSubtitles.source} />}
      >
        <form onSubmit={saveOpenSubtitles} className="space-y-4">
          <SettingsField
            id={`${fieldId}-opensubtitles-key`}
            label={t.settings.openSubtitles.apiKey}
            hint={t.settings.apiManagement.writeOnlyHint}
          >
            <input
              id={`${fieldId}-opensubtitles-key`}
              type="password"
              autoComplete="off"
              value={openSubtitlesKey}
              onChange={(event) => setOpenSubtitlesKey(event.target.value)}
              placeholder={t.settings.apiManagement.keepExistingPlaceholder}
              className={`${SETTINGS_INPUT_CLASSES} font-mono`}
            />
          </SettingsField>
          <SettingsField id={`${fieldId}-username`} label={t.settings.openSubtitles.username}>
            <input
              id={`${fieldId}-username`}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t.settings.openSubtitles.usernamePlaceholder}
              className={SETTINGS_INPUT_CLASSES}
            />
          </SettingsField>
          <SettingsField id={`${fieldId}-languages`} label={t.settings.openSubtitles.languages}>
            <input
              id={`${fieldId}-languages`}
              value={preferredLanguages}
              onChange={(event) => setPreferredLanguages(event.target.value)}
              placeholder="tr,en"
              className={SETTINGS_INPUT_CLASSES}
            />
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <SettingsButton type="submit" isLoading={updateSettings.isPending}>
              {t.settings.apiManagement.saveProvider}
            </SettingsButton>
            <SettingsButton
              type="button"
              variant="danger"
              icon={Trash2}
              disabled={settings?.openSubtitles.source !== 'user'}
              onClick={() => clearKey('openSubtitles')}
            >
              {t.settings.apiManagement.removeUserKey}
            </SettingsButton>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard
        id="settings-api-tmdb"
        title={t.settings.apiManagement.tmdbTitle}
        description={t.settings.apiManagement.tmdbDescription}
        icon={Clapperboard}
        action={<ProviderStatus source={settings?.tmdb.source} />}
      >
        <form onSubmit={saveTmdb} className="space-y-4">
          <SettingsField
            id={`${fieldId}-tmdb-key`}
            label={t.settings.apiManagement.tmdbApiKey}
            hint={t.settings.apiManagement.writeOnlyHint}
          >
            <input
              id={`${fieldId}-tmdb-key`}
              type="password"
              autoComplete="off"
              value={tmdbKey}
              onChange={(event) => setTmdbKey(event.target.value)}
              placeholder={t.settings.apiManagement.keepExistingPlaceholder}
              className={`${SETTINGS_INPUT_CLASSES} font-mono`}
            />
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <SettingsButton
              type="submit"
              disabled={!tmdbKey.trim()}
              isLoading={updateSettings.isPending}
            >
              {t.settings.apiManagement.saveProvider}
            </SettingsButton>
            <SettingsButton
              type="button"
              variant="danger"
              icon={Trash2}
              disabled={settings?.tmdb.source !== 'user'}
              onClick={() => clearKey('tmdb')}
            >
              {t.settings.apiManagement.removeUserKey}
            </SettingsButton>
          </div>
        </form>
      </SettingsCard>
    </div>
  );
};

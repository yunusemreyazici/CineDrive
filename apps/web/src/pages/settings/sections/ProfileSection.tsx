import React, { useId } from 'react';
import { User, Loader2 } from 'lucide-react';
import { useSessionQuery, useUpdateProfileMutation } from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import { SettingsCard, SettingsField, SETTINGS_INPUT_CLASSES } from '../SettingsCard';
import { t } from '../../../i18n';

export const ProfileSection: React.FC = () => {
  const { data: session } = useSessionQuery();
  const updateProfile = useUpdateProfileMutation();
  const fieldId = useId();
  const sessionName = session?.user?.name;

  const [name, setName] = useSyncedState(sessionName || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) return;

    updateProfile.mutate(
      { name: name.trim() },
      {
        onSuccess: () => toast.success(t.settings.profile.saved),
        onError: (error) => toast.fromError(error, t.settings.profile.updateFailed),
      },
    );
  };

  return (
    <SettingsCard
      id="settings-profile"
      title={t.settings.profile.title}
      description={t.settings.profile.description}
      icon={
        <div className="rounded-xl bg-brand-600/20 p-2.5 text-brand-400">
          <User className="h-5 w-5" />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SettingsField id={`${fieldId}-name`} label={t.settings.profile.displayName}>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.settings.profile.displayNamePlaceholder}
              className={SETTINGS_INPUT_CLASSES}
            />
          </SettingsField>

          <SettingsField id={`${fieldId}-email`} label={t.settings.profile.email}>
            <input
              id={`${fieldId}-email`}
              type="email"
              value={session?.user?.email || ''}
              disabled
              className={`${SETTINGS_INPUT_CLASSES} cursor-not-allowed font-mono text-zinc-500`}
            />
          </SettingsField>
        </div>

        <button
          type="submit"
          disabled={updateProfile.isPending || !name.trim() || name === sessionName}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 disabled:opacity-40"
        >
          {updateProfile.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t.settings.profile.updating}</span>
            </>
          ) : (
            <span>{t.settings.profile.update}</span>
          )}
        </button>
      </form>
    </SettingsCard>
  );
};

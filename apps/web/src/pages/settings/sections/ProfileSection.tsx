import React, { useId } from 'react';
import { User } from 'lucide-react';
import { useSessionQuery, useUpdateProfileMutation } from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import {
  SettingsButton,
  SettingsCard,
  SettingsField,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';
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
      icon={User}
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

        <SettingsButton
          type="submit"
          disabled={!name.trim() || name === sessionName}
          isLoading={updateProfile.isPending}
          loadingLabel={t.settings.profile.updating}
        >
          {t.settings.profile.update}
        </SettingsButton>
      </form>
    </SettingsCard>
  );
};

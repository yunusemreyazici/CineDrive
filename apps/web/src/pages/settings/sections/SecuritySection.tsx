import React, { useId, useState } from 'react';
import { Lock, KeyRound, Loader2 } from 'lucide-react';
import { useChangePasswordMutation } from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { SettingsCard, SettingsField, SETTINGS_INPUT_CLASSES } from '../SettingsCard';
import { t } from '../../../i18n';

const MIN_PASSWORD_LENGTH = 6;

export const SecuritySection: React.FC = () => {
  const changePassword = useChangePasswordMutation();
  const fieldId = useId();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword) {
      toast.error(t.settings.security.missingCurrent);
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(t.settings.security.tooShort(MIN_PASSWORD_LENGTH));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t.settings.security.mismatch);
      return;
    }

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast.success(t.settings.security.changed);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
        onError: (error) => toast.fromError(error, t.settings.security.changeFailed),
      },
    );
  };

  return (
    <SettingsCard
      id="settings-security"
      title={t.settings.security.title}
      description={t.settings.security.description}
      icon={
        <div className="rounded-xl bg-rose-500/10 p-2.5 text-rose-400">
          <Lock className="h-5 w-5" />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <SettingsField
          id={`${fieldId}-current`}
          label={t.settings.security.currentPassword}
          className="max-w-md"
        >
          <div className="relative">
            <KeyRound className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              id={`${fieldId}-current`}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className={`${SETTINGS_INPUT_CLASSES} pl-10`}
            />
          </div>
        </SettingsField>

        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <SettingsField
            id={`${fieldId}-new`}
            label={t.settings.security.newPassword(MIN_PASSWORD_LENGTH)}
          >
            <input
              id={`${fieldId}-new`}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className={SETTINGS_INPUT_CLASSES}
            />
          </SettingsField>

          <SettingsField id={`${fieldId}-confirm`} label={t.settings.security.confirmPassword}>
            <input
              id={`${fieldId}-confirm`}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className={SETTINGS_INPUT_CLASSES}
            />
          </SettingsField>
        </div>

        <button
          type="submit"
          disabled={
            changePassword.isPending || !currentPassword || !newPassword || !confirmPassword
          }
          className="flex items-center gap-2 rounded-xl bg-rose-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition-all hover:bg-rose-500 disabled:opacity-40"
        >
          {changePassword.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t.settings.security.changing}</span>
            </>
          ) : (
            <span>{t.settings.security.change}</span>
          )}
        </button>
      </form>
    </SettingsCard>
  );
};

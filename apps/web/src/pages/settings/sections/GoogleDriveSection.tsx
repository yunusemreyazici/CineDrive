import React from 'react';
import { ShieldCheck, AlertTriangle, ExternalLink, Unlink } from 'lucide-react';
import type { DriveScanSourceDto } from '@cinedrive/shared';
import {
  useGoogleStatusQuery,
  useUnlinkGoogleMutation,
  useUnlinkGoogleConnectionMutation,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { SettingsButton, SettingsCard, SettingsStatus } from '../SettingsCard';
import { t } from '../../../i18n';
import { connectionLabel, useGoogleConnections } from '../useGoogleConnections';

const startGoogleOAuth = () => {
  window.location.href = '/api/auth/google';
};

interface GoogleDriveSectionProps {
  driveSources: DriveScanSourceDto[];
}

export const GoogleDriveSection: React.FC<GoogleDriveSectionProps> = ({ driveSources }) => {
  const { isLoading: isGoogleLoading } = useGoogleStatusQuery();
  const unlinkGoogle = useUnlinkGoogleMutation();
  const unlinkConnection = useUnlinkGoogleConnectionMutation();
  const allConnections = useGoogleConnections();

  return (
    <SettingsCard
      id="settings-google"
      title={t.settings.google.title}
      description={t.settings.google.description}
      icon={ShieldCheck}
      width="full"
      action={
        allConnections.length > 0 ? (
          <SettingsStatus tone="ok">
            {t.settings.google.connectedCount(allConnections.length)}
          </SettingsStatus>
        ) : (
          <SettingsStatus tone="warning" icon={AlertTriangle}>
            {t.settings.google.notConnected}
          </SettingsStatus>
        )
      }
    >
      {isGoogleLoading ? (
        <div className="h-10 animate-pulse rounded-lg bg-zinc-800/40" />
      ) : allConnections.length > 0 ? (
        <div className="space-y-5">
          <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
            {allConnections.map((connection, index) => {
              const sourceCount = driveSources.filter(
                (source) => source.googleConnectionId === connection.id,
              ).length;

              return (
                <li
                  key={connection.id || index}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] text-zinc-300">
                        {connectionLabel(connection, index)}
                      </span>
                      {sourceCount > 0 && (
                        <span className="mt-1 block text-xs text-zinc-600">
                          {t.settings.google.sourcesInUse(sourceCount)}
                        </span>
                      )}
                    </span>
                  </span>
                  {connection.id ? (
                    <button
                      type="button"
                      onClick={() =>
                        unlinkConnection.mutate(connection.id!, {
                          onSuccess: () => toast.success(t.settings.google.removed),
                          onError: (error) =>
                            toast.fromError(error, t.settings.google.removeFailed),
                        })
                      }
                      disabled={unlinkConnection.isPending || sourceCount > 0}
                      title={sourceCount > 0 ? t.settings.google.removeSourcesFirst : undefined}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                    >
                      {t.settings.google.remove}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <SettingsButton variant="secondary" icon={ExternalLink} onClick={startGoogleOAuth}>
              {t.settings.google.addAnother}
            </SettingsButton>

            <SettingsButton
              variant="danger"
              icon={Unlink}
              isLoading={unlinkGoogle.isPending}
              disabled={driveSources.length > 0}
              title={driveSources.length > 0 ? t.settings.google.removeSourcesFirst : undefined}
              onClick={() =>
                unlinkGoogle.mutate(undefined, {
                  onSuccess: () => toast.success(t.settings.google.cleared),
                  onError: (error) => toast.fromError(error, t.settings.google.clearFailed),
                })
              }
            >
              {t.settings.google.clearAll}
            </SettingsButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="max-w-prose text-[13px] leading-relaxed text-zinc-400">
            {t.settings.google.connectPrompt}
          </p>
          <SettingsButton icon={ExternalLink} onClick={startGoogleOAuth}>
            {t.settings.google.connect}
          </SettingsButton>
        </div>
      )}
    </SettingsCard>
  );
};

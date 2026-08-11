import React, { useState } from 'react';
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
import {
  connectionLabel,
  useGoogleConnections,
  type GoogleConnection,
} from '../useGoogleConnections';
import { Modal } from '../../../components/common/Modal';

const startGoogleOAuth = () => {
  window.location.href = '/api/auth/google';
};

interface GoogleDriveSectionProps {
  driveSources: DriveScanSourceDto[];
}

type RemovalTarget =
  | { kind: 'connection'; connection: GoogleConnection; label: string; sourceCount: number }
  | { kind: 'all'; connectionCount: number; sourceCount: number };

export const GoogleDriveSection: React.FC<GoogleDriveSectionProps> = ({ driveSources }) => {
  const { isLoading: isGoogleLoading } = useGoogleStatusQuery();
  const unlinkGoogle = useUnlinkGoogleMutation();
  const unlinkConnection = useUnlinkGoogleConnectionMutation();
  const allConnections = useGoogleConnections();
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);
  const isRemoving = unlinkConnection.isPending || unlinkGoogle.isPending;

  const handleRemove = async () => {
    if (!removalTarget) return;
    try {
      if (removalTarget.kind === 'all') {
        const removed = await unlinkGoogle.mutateAsync();
        toast.success(t.settings.google.cleared(removed.files, removed.media));
      } else if (removalTarget.connection.id) {
        const removed = await unlinkConnection.mutateAsync(removalTarget.connection.id);
        toast.success(t.settings.google.removed(removed.files, removed.media));
      }
      setRemovalTarget(null);
    } catch (error) {
      toast.fromError(
        error,
        removalTarget.kind === 'all'
          ? t.settings.google.clearFailed
          : t.settings.google.removeFailed,
      );
    }
  };

  return (
    <>
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
                const label = connectionLabel(connection, index);

                return (
                  <li
                    key={connection.id || index}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[13px] text-zinc-300">
                          {label}
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
                          setRemovalTarget({ kind: 'connection', connection, label, sourceCount })
                        }
                        disabled={isRemoving}
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
                disabled={isRemoving}
                onClick={() =>
                  setRemovalTarget({
                    kind: 'all',
                    connectionCount: allConnections.length,
                    sourceCount: driveSources.length,
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

      <Modal
        isOpen={!!removalTarget}
        onClose={() => setRemovalTarget(null)}
        size="sm"
        title={
          removalTarget?.kind === 'all'
            ? t.settings.google.clearTitle
            : t.settings.google.removeTitle
        }
        description={removalTarget?.kind === 'connection' ? removalTarget.label : undefined}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <SettingsButton variant="secondary" onClick={() => setRemovalTarget(null)}>
              {t.common.cancel}
            </SettingsButton>
            <SettingsButton
              variant="danger"
              icon={Unlink}
              onClick={handleRemove}
              isLoading={isRemoving}
              loadingLabel={t.settings.google.removing}
            >
              {removalTarget?.kind === 'all'
                ? t.settings.google.clearConfirm
                : t.settings.google.removeConfirm}
            </SettingsButton>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          {removalTarget?.kind === 'all'
            ? t.settings.google.clearBody(
                removalTarget.connectionCount,
                removalTarget.sourceCount,
              )
            : t.settings.google.removeBody(removalTarget?.sourceCount || 0)}
        </p>
      </Modal>
    </>
  );
};

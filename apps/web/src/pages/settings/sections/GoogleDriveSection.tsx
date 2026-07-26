import React from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, ExternalLink, Unlink } from 'lucide-react';
import {
  useGoogleStatusQuery,
  useUnlinkGoogleMutation,
  useUnlinkGoogleConnectionMutation,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { SettingsCard } from '../SettingsCard';
import { t } from '../../../i18n';
import { connectionLabel, useGoogleConnections } from '../useGoogleConnections';

const startGoogleOAuth = () => {
  window.location.href = '/api/auth/google';
};

export const GoogleDriveSection: React.FC = () => {
  const { isLoading: isGoogleLoading } = useGoogleStatusQuery();
  const unlinkGoogle = useUnlinkGoogleMutation();
  const unlinkConnection = useUnlinkGoogleConnectionMutation();
  const allConnections = useGoogleConnections();

  return (
    <SettingsCard
      id="settings-google"
      title={t.settings.google.title}
      description={t.settings.google.description}
      icon={
        <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-400">
          <ShieldCheck className="h-5 w-5" />
        </div>
      }
      action={
        allConnections.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {t.settings.google.connectedCount(allConnections.length)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {t.settings.google.notConnected}
          </span>
        )
      }
    >
      {isGoogleLoading ? (
        <div className="h-12 animate-pulse rounded-xl bg-zinc-800/50" />
      ) : allConnections.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {t.settings.google.connectedAccounts}
            </p>
            <ul className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/60">
              {allConnections.map((connection, index) => (
                <li
                  key={connection.id || index}
                  className="flex items-center justify-between gap-3 p-3.5 text-xs"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="font-mono font-semibold text-zinc-200">
                      {connectionLabel(connection, index)}
                    </span>
                  </span>
                  {connection.id ? (
                    <button
                      type="button"
                      onClick={() =>
                        unlinkConnection.mutate(connection.id!, {
                          onSuccess: () => toast.success(t.settings.google.removed),
                          onError: (error) => toast.fromError(error, t.settings.google.removeFailed),
                        })
                      }
                      disabled={unlinkConnection.isPending}
                      className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20"
                    >
                      {t.settings.google.remove}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={startGoogleOAuth}
              className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500"
            >
              <ExternalLink className="h-4 w-4" />
              {t.settings.google.addAnother}
            </button>

            <button
              type="button"
              onClick={() =>
                unlinkGoogle.mutate(undefined, {
                  onSuccess: () => toast.success(t.settings.google.cleared),
                  onError: (error) => toast.fromError(error, t.settings.google.clearFailed),
                })
              }
              disabled={unlinkGoogle.isPending}
              className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
            >
              <Unlink className="h-4 w-4" />
              {t.settings.google.clearAll}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            {t.settings.google.connectPrompt}
          </p>
          <button
            type="button"
            onClick={startGoogleOAuth}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500"
          >
            <ExternalLink className="h-4 w-4" />
            {t.settings.google.connect}
          </button>
        </div>
      )}
    </SettingsCard>
  );
};

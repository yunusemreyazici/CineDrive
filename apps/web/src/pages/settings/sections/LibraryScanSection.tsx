import React, { useId } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import {
  useLibrariesQuery,
  useUpdateLibraryMutation,
  useScanLibraryMutation,
  useLibraryScansQuery,
} from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import { SettingsCard, SettingsField, SETTINGS_INPUT_CLASSES } from '../SettingsCard';
import { t } from '../../../i18n';
import { connectionLabel, useGoogleConnections } from '../useGoogleConnections';

type ScanMode = 'all' | 'folder';

export const LibraryScanSection: React.FC = () => {
  const fieldId = useId();
  const { data: libraries } = useLibrariesQuery();
  const updateLibrary = useUpdateLibraryMutation();
  const scanLibrary = useScanLibraryMutation();
  const allConnections = useGoogleConnections();

  const activeLibrary = libraries?.find((library) => library.storageType === 'gdrive');
  const { data: scanHistory } = useLibraryScansQuery(activeLibrary?.id);
  const lastScan = scanHistory?.[0];

  // Mirror the saved library configuration whenever a different library — or a
  // freshly saved version of it — arrives.
  const savedRootFolderId = activeLibrary?.rootFolderId || '';
  const savedConnectionId = activeLibrary?.googleConnectionId || '';

  const [scanMode, setScanMode] = useSyncedState<ScanMode>(
    savedRootFolderId ? 'folder' : 'all',
  );
  const [folderId, setFolderId] = useSyncedState(savedRootFolderId);
  const [connectionId, setConnectionId] = useSyncedState(savedConnectionId);

  const isScanning = scanLibrary.isPending || lastScan?.status === 'running';

  const handleScanTrigger = () => {
    if (!activeLibrary) return;
    scanLibrary.mutate(activeLibrary.id, {
      onError: (error) => toast.fromError(error, t.settings.scan.startFailed),
    });
  };

  const handleSaveScanSettings = async () => {
    if (!activeLibrary) return;
    try {
      await updateLibrary.mutateAsync({
        id: activeLibrary.id,
        data: {
          rootFolderId: scanMode === 'folder' ? folderId.trim() : '',
          googleConnectionId: connectionId || null,
        },
      });
      toast.success(t.settings.scan.scopeSaved);
    } catch (error) {
      toast.fromError(error, t.settings.scan.scopeSaveFailed);
    }
  };

  return (
    <SettingsCard
      id="settings-scan"
      title={t.settings.scan.title}
      description={t.settings.scan.description}
      icon={
        <div className="rounded-xl bg-brand-600/20 p-2.5 text-brand-400">
          <RefreshCw className="h-5 w-5" />
        </div>
      }
      action={
        <button
          type="button"
          onClick={handleScanTrigger}
          disabled={isScanning || allConnections.length === 0}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 disabled:opacity-40"
        >
          {isScanning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.settings.scan.scanning}
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              {t.settings.scan.trigger}
            </>
          )}
        </button>
      }
    >
      <div
        role="radiogroup"
        aria-label={t.settings.scan.scopeLabel}
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
      >
        {(
          [
            {
              mode: 'all' as const,
              title: t.settings.scan.allDriveTitle,
              detail: t.settings.scan.allDriveDetail,
            },
            {
              mode: 'folder' as const,
              title: t.settings.scan.folderTitle,
              detail: t.settings.scan.folderDetail,
            },
          ]
        ).map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={scanMode === option.mode}
            onClick={() => setScanMode(option.mode)}
            className={`rounded-2xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              scanMode === option.mode
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
            }`}
          >
            <p className="text-sm font-semibold text-white">{option.title}</p>
            <p className="mt-1 text-xs text-zinc-400">{option.detail}</p>
          </button>
        ))}
      </div>

      {scanMode === 'folder' && (
        <SettingsField
          id={`${fieldId}-folder`}
          label={t.settings.scan.folderId}
          hint={
            <>
              {t.settings.scan.folderIdHintPrefix} <span className="font-mono">/folders/</span>{' '}
              {t.settings.scan.folderIdHintSuffix}
            </>
          }
        >
          <input
            id={`${fieldId}-folder`}
            type="text"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder={t.settings.scan.folderIdPlaceholder}
            className={`${SETTINGS_INPUT_CLASSES} font-mono`}
          />
        </SettingsField>
      )}

      <SettingsField
        id={`${fieldId}-connection`}
        label={t.settings.scan.account}
        hint={
          scanMode === 'folder' && !connectionId && allConnections.length > 1 ? (
            <span className="text-amber-400">
              {t.settings.scan.accountHint}
            </span>
          ) : undefined
        }
      >
        <select
          id={`${fieldId}-connection`}
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
          className={SETTINGS_INPUT_CLASSES}
        >
          <option value="">{t.settings.scan.allAccounts}</option>
          {allConnections.map((connection, index) =>
            connection.id ? (
              <option key={connection.id} value={connection.id}>
                {connectionLabel(connection, index)}
              </option>
            ) : null,
          )}
        </select>
      </SettingsField>

      <button
        type="button"
        onClick={handleSaveScanSettings}
        disabled={
          !activeLibrary ||
          updateLibrary.isPending ||
          (scanMode === 'folder' && !folderId.trim())
        }
        className="rounded-xl bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
      >
        {updateLibrary.isPending ? t.common.saving : t.settings.scan.saveScope}
      </button>

      {lastScan && (
        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-xs">
          <h4 className="font-display font-semibold text-zinc-200">{t.settings.scan.lastScan}</h4>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t.settings.scan.status, value: lastScan.status, tone: 'text-brand-400 capitalize' },
              { label: t.settings.scan.added, value: t.settings.scan.fileCount(lastScan.addedCount), tone: 'text-emerald-400' },
              {
                label: t.settings.scan.updated,
                value: t.settings.scan.fileCount(lastScan.updatedCount),
                tone: 'text-blue-400',
              },
              { label: t.settings.scan.errors, value: t.settings.scan.errorCount(lastScan.errorCount), tone: 'text-red-400' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-3"
              >
                <dt className="mb-0.5 block text-zinc-500">{stat.label}</dt>
                <dd className={`font-bold ${stat.tone}`}>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </SettingsCard>
  );
};

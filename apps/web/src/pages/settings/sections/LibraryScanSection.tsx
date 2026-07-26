import React, { useId } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  useLibrariesQuery,
  useUpdateLibraryMutation,
  useScanLibraryMutation,
  useLibraryScansQuery,
} from '../../../hooks/useApi';
import { useSyncedState } from '../../../hooks/useSyncedState';
import { toast } from '../../../stores/useToastStore';
import {
  SettingsButton,
  SettingsCard,
  SettingsChoice,
  SettingsField,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';
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
      icon={RefreshCw}
      width="full"
      action={
        <SettingsButton
          icon={RefreshCw}
          onClick={handleScanTrigger}
          disabled={allConnections.length === 0}
          isLoading={isScanning}
          loadingLabel={t.settings.scan.scanning}
        >
          {t.settings.scan.trigger}
        </SettingsButton>
      }
    >
      <div className="space-y-5">
        <div
          role="radiogroup"
          aria-label={t.settings.scan.scopeLabel}
          className="grid grid-cols-1 gap-2 md:grid-cols-2"
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
            <SettingsChoice
              key={option.mode}
              selected={scanMode === option.mode}
              onSelect={() => setScanMode(option.mode)}
              title={option.title}
              description={option.detail}
            />
          ))}
        </div>

        <div className="max-w-xl space-y-4">
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
                <span className="text-amber-400">{t.settings.scan.accountHint}</span>
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

          <SettingsButton
            variant="secondary"
            onClick={handleSaveScanSettings}
            disabled={!activeLibrary || (scanMode === 'folder' && !folderId.trim())}
            isLoading={updateLibrary.isPending}
            loadingLabel={t.common.saving}
          >
            {t.settings.scan.saveScope}
          </SettingsButton>
        </div>

        {lastScan && (
          <div className="border-t border-zinc-800/60 pt-4">
            <h4 className="text-[13px] font-medium text-zinc-300">{t.settings.scan.lastScan}</h4>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {[
                {
                  label: t.settings.scan.status,
                  value: lastScan.status,
                  tone: 'text-zinc-100 capitalize',
                },
                {
                  label: t.settings.scan.added,
                  value: t.settings.scan.fileCount(lastScan.addedCount),
                  tone: 'text-zinc-100',
                },
                {
                  label: t.settings.scan.updated,
                  value: t.settings.scan.fileCount(lastScan.updatedCount),
                  tone: 'text-zinc-100',
                },
                {
                  label: t.settings.scan.errors,
                  value: t.settings.scan.errorCount(lastScan.errorCount),
                  // Only a non-zero error count earns colour.
                  tone: lastScan.errorCount > 0 ? 'text-rose-400' : 'text-zinc-100',
                },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-xs text-zinc-500">{stat.label}</dt>
                  <dd className={`mt-0.5 text-[13px] font-medium ${stat.tone}`}>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </SettingsCard>
  );
};

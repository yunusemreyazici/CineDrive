import React, { useId, useState } from 'react';
import { AlertTriangle, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import type { DriveScanSourceDto } from '@cinedrive/shared';
import {
  useLibrariesQuery,
  useCreateDriveScanSourceMutation,
  useDeleteDriveScanSourceMutation,
  useDriveScanSourcesQuery,
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
import { Modal } from '../../../components/common/Modal';

type ScanMode = 'all' | 'folder';

export const LibraryScanSection: React.FC = () => {
  const fieldId = useId();
  const { data: libraries } = useLibrariesQuery();
  const createSource = useCreateDriveScanSourceMutation();
  const deleteSource = useDeleteDriveScanSourceMutation();
  const scanLibrary = useScanLibraryMutation();
  const allConnections = useGoogleConnections();

  const activeLibrary = libraries?.find((library) => library.storageType === 'gdrive');
  const { data: sources = [] } = useDriveScanSourcesQuery(activeLibrary?.id);
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
  const [sourceToRemove, setSourceToRemove] = useState<DriveScanSourceDto | null>(null);

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
      await createSource.mutateAsync({
        libraryId: activeLibrary.id,
        rootFolderId: scanMode === 'folder' ? folderId.trim() : '',
        googleConnectionId: connectionId,
      });
      toast.success(t.settings.scan.scopeSaved);
    } catch (error) {
      toast.fromError(error, t.settings.scan.scopeSaveFailed);
    }
  };

  const handleRemoveSource = async () => {
    if (!activeLibrary || !sourceToRemove) return;
    try {
      const removed = await deleteSource.mutateAsync({
        libraryId: activeLibrary.id,
        sourceId: sourceToRemove.id,
      });
      setSourceToRemove(null);
      toast.success(t.settings.scan.sourceRemoved(removed.files));
    } catch (error) {
      toast.fromError(error, t.settings.scan.sourceRemoveFailed);
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
              <option value="">{t.settings.scan.selectAccount}</option>
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
            disabled={
              !activeLibrary || !connectionId || (scanMode === 'folder' && !folderId.trim())
            }
            isLoading={createSource.isPending}
            loadingLabel={t.common.saving}
          >
            {t.settings.scan.saveScope}
          </SettingsButton>
        </div>

        <div className="border-t border-zinc-800/60 pt-4">
          <h4 className="text-[13px] font-medium text-zinc-300">
            {t.settings.scan.savedSources}
          </h4>
          {sources.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">{t.settings.scan.noSavedSources}</p>
          ) : (
            <div className="mt-3 divide-y divide-zinc-800/60 rounded-xl border border-zinc-800/70">
              {sources.map((source) => (
                <div key={source.id} className="flex items-center gap-3 px-4 py-3">
                  <FolderOpen className="h-4 w-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-zinc-200">
                      {source.googleAccountEmail}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      {source.rootFolderId || t.settings.scan.entireDrive}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {t.settings.scan.fileCount(source.fileCount)}
                  </span>
                  <SettingsButton
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setSourceToRemove(source)}
                    disabled={isScanning}
                    className="px-2.5"
                  >
                    {t.settings.scan.disconnect}
                  </SettingsButton>
                </div>
              ))}
            </div>
          )}
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

      <Modal
        isOpen={!!sourceToRemove}
        onClose={() => setSourceToRemove(null)}
        size="sm"
        title={t.settings.scan.disconnectTitle}
        description={sourceToRemove?.googleAccountEmail}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <SettingsButton variant="secondary" onClick={() => setSourceToRemove(null)}>
              {t.common.cancel}
            </SettingsButton>
            <SettingsButton
              variant="danger"
              icon={Trash2}
              onClick={handleRemoveSource}
              isLoading={deleteSource.isPending}
            >
              {t.settings.scan.disconnectConfirm}
            </SettingsButton>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          {t.settings.scan.disconnectBody(
            sourceToRemove?.rootFolderId || t.settings.scan.entireDrive,
          )}
        </p>
      </Modal>
    </SettingsCard>
  );
};

import React, { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { DriveScanSourceDto, LibraryDto, SourceScanSummaryDto } from '@cinedrive/shared';
import {
  useAllLibraryScansQuery,
  useCreateDriveScanSourceMutation,
  useCreateLibraryMutation,
  useDeleteDriveScanSourceMutation,
  useDeleteLibraryMutation,
  useDriveScanSourcesQuery,
  useLibrariesQuery,
  useScanDriveSourceMutation,
  useScanLibraryMutation,
  useValidateDriveScanSourceMutation,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { t } from '../../../i18n';
import { Modal } from '../../../components/common/Modal';
import { connectionLabel, useGoogleConnections } from '../useGoogleConnections';
import {
  SettingsButton,
  SettingsCard,
  SettingsChoice,
  SettingsField,
  SettingsStatus,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';

type SourceRemovalTarget =
  { kind: 'drive'; source: DriveScanSourceDto } | { kind: 'local'; library: LibraryDto };

type SourceRow = {
  key: string;
  kind: 'drive' | 'local';
  id: string;
  libraryId: string;
  name: string;
  typeLabel: string;
  location: string;
  fileCount: number;
  lastScan?: SourceScanSummaryDto | null;
  webViewLink?: string | null;
  driveSource?: DriveScanSourceDto;
  localLibrary?: LibraryDto;
};

const formatDateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : t.settings.sourceManager.notScanned;

const formatDuration = (durationMs?: number | null) =>
  durationMs == null
    ? null
    : t.settings.sourceManager.duration(Math.max(1, Math.round(durationMs / 1000)));

const scanTone = (status?: SourceScanSummaryDto['status']) =>
  status === 'failed' || status === 'interrupted'
    ? 'warning'
    : status === 'completed'
      ? 'ok'
      : 'neutral';

const scanStatusLabel = (
  status?: SourceScanSummaryDto['status'],
  reason?: SourceScanSummaryDto['interruptionReason'],
) => {
  if (status === 'running') return t.settings.sourceManager.running;
  if (status === 'completed') return t.settings.sourceManager.completed;
  if (status === 'failed') return t.settings.sourceManager.failed;
  if (status === 'interrupted') {
    return reason === 'watchdog_timeout'
      ? t.settings.sourceManager.watchdogInterrupted
      : t.settings.sourceManager.interrupted;
  }
  return t.settings.sourceManager.notScanned;
};

export const LibrarySourceManagerSection: React.FC = () => {
  const fieldId = useId();
  const { data: libraries = [] } = useLibrariesQuery();
  const driveLibrary = libraries.find((library) => library.storageType === 'gdrive');
  const localLibraries = libraries.filter((library) => library.storageType === 'local');
  const { data: driveSources = [] } = useDriveScanSourcesQuery(driveLibrary?.id);
  const { data: scans = [] } = useAllLibraryScansQuery();
  const connections = useGoogleConnections();

  const validateDriveSource = useValidateDriveScanSourceMutation();
  const createDriveSource = useCreateDriveScanSourceMutation();
  const deleteDriveSource = useDeleteDriveScanSourceMutation();
  const scanDriveSource = useScanDriveSourceMutation();
  const createLibrary = useCreateLibraryMutation();
  const deleteLibrary = useDeleteLibraryMutation();
  const scanLibrary = useScanLibraryMutation();

  const [driveMode, setDriveMode] = useState<'all' | 'folder'>('folder');
  const [connectionId, setConnectionId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [localName, setLocalName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [scanAllPending, setScanAllPending] = useState(false);
  const [scanningRows, setScanningRows] = useState<Set<string>>(new Set());
  const [removalTarget, setRemovalTarget] = useState<SourceRemovalTarget | null>(null);

  const rows = useMemo<SourceRow[]>(
    () => [
      ...driveSources.map((source) => ({
        key: `drive-${source.id}`,
        kind: 'drive' as const,
        id: source.id,
        libraryId: source.libraryId,
        name: source.folderName || source.rootFolderId || t.settings.sourceManager.entireDrive,
        typeLabel: source.driveName || source.ownerName || t.settings.sourceManager.driveFolder,
        location: `${source.googleAccountEmail} · ${source.folderPath || source.rootFolderId || t.settings.sourceManager.entireDrive}`,
        fileCount: source.fileCount,
        lastScan: source.lastScan,
        webViewLink: source.webViewLink,
        driveSource: source,
      })),
      ...localLibraries.map((library) => ({
        key: `local-${library.id}`,
        kind: 'local' as const,
        id: library.id,
        libraryId: library.id,
        name: library.name,
        typeLabel: t.settings.sourceManager.localFolder,
        location: library.localFolderPath || '',
        fileCount: library.fileCount || 0,
        lastScan: library.lastScan,
        localLibrary: library,
      })),
    ],
    [driveSources, localLibraries],
  );

  const runningCount = rows.filter(
    (row) => row.lastScan?.status === 'running' || scanningRows.has(row.key),
  ).length;

  const updateScanningRows = (key: string, active: boolean) => {
    setScanningRows((current) => {
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleAddDriveSource = async () => {
    if (!driveLibrary || !connectionId || (driveMode === 'folder' && !folderId.trim())) return;
    const rootFolderId = driveMode === 'folder' ? folderId.trim() : '';
    try {
      const validation = await validateDriveSource.mutateAsync({
        libraryId: driveLibrary.id,
        googleConnectionId: connectionId,
        rootFolderId,
      });
      await createDriveSource.mutateAsync({
        libraryId: driveLibrary.id,
        googleConnectionId: connectionId,
        rootFolderId,
      });
      setFolderId('');
      toast.success(t.settings.sourceManager.validationPassed(validation.folderName));
    } catch (error) {
      toast.fromError(error, t.settings.sourceManager.validationFailed);
    }
  };

  const handleAddLocalSource = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!localName.trim() || !localPath.trim()) return;
    try {
      const library = await createLibrary.mutateAsync({
        name: localName.trim(),
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: localPath.trim(),
      });
      setLocalName('');
      setLocalPath('');
      toast.success(t.settings.localLibrary.created(localName));
      await scanLibrary.mutateAsync(library.id);
    } catch (error) {
      toast.fromError(error, t.settings.localLibrary.createFailed);
    }
  };

  const handleScanRow = async (row: SourceRow) => {
    updateScanningRows(row.key, true);
    try {
      if (row.kind === 'drive') {
        await scanDriveSource.mutateAsync({ libraryId: row.libraryId, sourceId: row.id });
        toast.success(t.settings.scan.sourceScanStarted);
      } else {
        await scanLibrary.mutateAsync(row.libraryId);
      }
    } catch (error) {
      toast.fromError(
        error,
        row.kind === 'drive' ? t.settings.scan.sourceScanFailed : t.settings.scan.startFailed,
      );
    } finally {
      updateScanningRows(row.key, false);
    }
  };

  const handleScanAll = async () => {
    const libraryIds = [
      ...(driveLibrary && driveSources.length > 0 ? [driveLibrary.id] : []),
      ...localLibraries.map((library) => library.id),
    ];
    if (libraryIds.length === 0) return;

    setScanAllPending(true);
    const results = await Promise.allSettled(
      libraryIds.map((libraryId) => scanLibrary.mutateAsync(libraryId)),
    );
    setScanAllPending(false);
    const started = results.filter((result) => result.status === 'fulfilled').length;
    if (started > 0) toast.success(t.settings.sourceManager.scanAllStarted(started));
    if (started !== results.length) toast.error(t.settings.sourceManager.scanAllFailed);
  };

  const handleRemove = async () => {
    if (!removalTarget) return;
    try {
      if (removalTarget.kind === 'drive' && driveLibrary) {
        const removed = await deleteDriveSource.mutateAsync({
          libraryId: driveLibrary.id,
          sourceId: removalTarget.source.id,
        });
        toast.success(t.settings.scan.sourceRemoved(removed.files));
      } else if (removalTarget.kind === 'local') {
        const removed = await deleteLibrary.mutateAsync(removalTarget.library.id);
        toast.success(t.settings.localLibrary.removed(removed.files));
      }
      setRemovalTarget(null);
    } catch (error) {
      toast.fromError(
        error,
        removalTarget.kind === 'drive'
          ? t.settings.scan.sourceRemoveFailed
          : t.settings.localLibrary.removeFailed,
      );
    }
  };

  const isRemoving = deleteDriveSource.isPending || deleteLibrary.isPending;

  return (
    <>
      <SettingsCard
        id="settings-library-source-manager"
        title={t.settings.sourceManager.title}
        description={t.settings.sourceManager.description}
        icon={FolderOpen}
        width="full"
        action={
          <SettingsButton
            icon={RefreshCw}
            onClick={handleScanAll}
            disabled={rows.length === 0 || runningCount > 0}
            isLoading={scanAllPending}
            loadingLabel={t.settings.sourceManager.scanningAll}
          >
            {t.settings.sourceManager.scanAll}
          </SettingsButton>
        }
      >
        {rows.length === 0 ? (
          <p className="text-[13px] text-zinc-500">{t.settings.sourceManager.noSources}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800/70">
            <table className="w-full min-w-[920px] text-left">
              <thead className="bg-zinc-900/40 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t.settings.sourceManager.source}</th>
                  <th className="px-4 py-3 font-medium">{t.settings.sourceManager.location}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.settings.sourceManager.files}
                  </th>
                  <th className="px-4 py-3 font-medium">{t.settings.sourceManager.lastScan}</th>
                  <th className="px-4 py-3 font-medium">{t.settings.sourceManager.status}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.settings.sourceManager.actions}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {rows.map((row) => {
                  const rowScanning =
                    row.lastScan?.status === 'running' || scanningRows.has(row.key);
                  return (
                    <tr key={row.key} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex min-w-44 items-start gap-2.5">
                          {row.kind === 'drive' ? (
                            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                          ) : (
                            <Folder className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-zinc-200">
                              {row.name}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-600">{row.typeLabel}</p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <p
                          className="truncate font-mono text-xs text-zinc-500"
                          title={row.location}
                        >
                          {row.location}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[13px] text-zinc-300">
                        {row.fileCount}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-zinc-300">
                          {formatDateTime(row.lastScan?.completedAt || row.lastScan?.startedAt)}
                        </p>
                        {row.lastScan && (
                          <p className="mt-1 whitespace-nowrap text-[11px] text-zinc-600">
                            {[
                              t.settings.sourceManager.added(row.lastScan.addedCount),
                              t.settings.sourceManager.updated(row.lastScan.updatedCount),
                              t.settings.sourceManager.deleted(row.lastScan.deletedCount),
                              formatDuration(row.lastScan.durationMs),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <SettingsStatus
                          tone={scanTone(rowScanning ? 'running' : row.lastScan?.status)}
                        >
                          {scanStatusLabel(
                            rowScanning ? 'running' : row.lastScan?.status,
                            row.lastScan?.interruptionReason,
                          )}
                        </SettingsStatus>
                        {!!row.lastScan?.errorCount && (
                          <p
                            className="mt-1 max-w-48 truncate text-[11px] text-amber-400"
                            title={row.lastScan.lastError || undefined}
                          >
                            {t.settings.sourceManager.errors(row.lastScan.errorCount)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {row.webViewLink && (
                            <a
                              href={row.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {t.settings.sourceManager.openDrive}
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => handleScanRow(row)}
                            disabled={rowScanning || isRemoving}
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${rowScanning ? 'animate-spin' : ''}`}
                            />
                            {t.settings.scan.rescanSource}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRemovalTarget(
                                row.kind === 'drive'
                                  ? { kind: 'drive', source: row.driveSource! }
                                  : { kind: 'local', library: row.localLibrary! },
                              )
                            }
                            disabled={rowScanning || isRemoving}
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t.settings.localLibrary.remove}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-7 grid gap-8 border-t border-zinc-800/60 pt-6 lg:grid-cols-2">
          <div>
            <h4 className="text-[13px] font-medium text-zinc-200">
              {t.settings.sourceManager.addDrive}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {t.settings.sourceManager.addDriveDescription}
            </p>
            <div className="mt-4 space-y-4">
              <div
                role="radiogroup"
                aria-label={t.settings.scan.scopeLabel}
                className="grid grid-cols-2 gap-2"
              >
                <SettingsChoice
                  selected={driveMode === 'all'}
                  onSelect={() => setDriveMode('all')}
                  title={t.settings.scan.allDriveTitle}
                  description={t.settings.scan.allDriveDetail}
                />
                <SettingsChoice
                  selected={driveMode === 'folder'}
                  onSelect={() => setDriveMode('folder')}
                  title={t.settings.scan.folderTitle}
                  description={t.settings.scan.folderDetail}
                />
              </div>
              {driveMode === 'folder' && (
                <SettingsField id={`${fieldId}-drive-folder`} label={t.settings.scan.folderId}>
                  <input
                    id={`${fieldId}-drive-folder`}
                    value={folderId}
                    onChange={(event) => setFolderId(event.target.value)}
                    placeholder={t.settings.scan.folderIdPlaceholder}
                    className={`${SETTINGS_INPUT_CLASSES} font-mono`}
                  />
                </SettingsField>
              )}
              <SettingsField id={`${fieldId}-drive-account`} label={t.settings.scan.account}>
                <select
                  id={`${fieldId}-drive-account`}
                  value={connectionId}
                  onChange={(event) => setConnectionId(event.target.value)}
                  className={SETTINGS_INPUT_CLASSES}
                >
                  <option value="">{t.settings.scan.selectAccount}</option>
                  {connections.map((connection, index) =>
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
                icon={FolderPlus}
                onClick={handleAddDriveSource}
                disabled={
                  !driveLibrary || !connectionId || (driveMode === 'folder' && !folderId.trim())
                }
                isLoading={validateDriveSource.isPending || createDriveSource.isPending}
                loadingLabel={t.settings.sourceManager.validating}
              >
                {t.settings.sourceManager.validateAndSave}
              </SettingsButton>
            </div>
          </div>

          <form onSubmit={handleAddLocalSource}>
            <h4 className="text-[13px] font-medium text-zinc-200">
              {t.settings.sourceManager.addLocal}
            </h4>
            <div className="mt-4 space-y-4">
              <SettingsField id={`${fieldId}-local-name`} label={t.settings.localLibrary.name}>
                <input
                  id={`${fieldId}-local-name`}
                  value={localName}
                  onChange={(event) => setLocalName(event.target.value)}
                  placeholder={t.settings.localLibrary.namePlaceholder}
                  className={SETTINGS_INPUT_CLASSES}
                />
              </SettingsField>
              <SettingsField id={`${fieldId}-local-path`} label={t.settings.localLibrary.path}>
                <input
                  id={`${fieldId}-local-path`}
                  value={localPath}
                  onChange={(event) => setLocalPath(event.target.value)}
                  placeholder={t.settings.localLibrary.pathPlaceholder}
                  className={`${SETTINGS_INPUT_CLASSES} font-mono`}
                />
              </SettingsField>
              <SettingsButton
                type="submit"
                variant="secondary"
                icon={FolderPlus}
                disabled={!localName.trim() || !localPath.trim()}
                isLoading={createLibrary.isPending}
                loadingLabel={t.settings.localLibrary.creating}
              >
                {t.settings.localLibrary.create}
              </SettingsButton>
            </div>
          </form>
        </div>
      </SettingsCard>

      <SettingsCard
        id="settings-scan-history"
        title={t.settings.sourceManager.historyTitle}
        description={t.settings.sourceManager.historyDescription}
        icon={History}
        width="full"
        action={
          <SettingsButton variant="secondary" onClick={() => setShowHistory((visible) => !visible)}>
            {showHistory
              ? t.settings.sourceManager.hideHistory
              : t.settings.sourceManager.showHistory}
          </SettingsButton>
        }
      >
        {showHistory &&
          (scans.length === 0 ? (
            <p className="text-[13px] text-zinc-500">{t.settings.sourceManager.noHistory}</p>
          ) : (
            <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
              {scans.map((scan) => (
                <li key={scan.id} className="py-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-start">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-zinc-200">
                        {scan.sourceName || t.settings.sourceManager.allDriveSources}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-xs text-zinc-600">
                        {scan.sourceLocation}
                      </p>
                    </div>
                    <div className="text-xs text-zinc-500">
                      <span className="block text-[11px] text-zinc-600">
                        {t.settings.sourceManager.startedAt}
                      </span>
                      {formatDateTime(scan.startedAt)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      <span className="block text-[11px] text-zinc-600">
                        {t.settings.sourceManager.result}
                      </span>
                      {t.settings.sourceManager.added(scan.addedCount)} ·{' '}
                      {t.settings.sourceManager.updated(scan.updatedCount)} ·{' '}
                      {t.settings.sourceManager.deleted(scan.deletedCount)}
                    </div>
                    <SettingsStatus tone={scanTone(scan.status)}>
                      {scanStatusLabel(scan.status, scan.interruptionReason)}
                    </SettingsStatus>
                  </div>
                  {!!scan.errors?.length && (
                    <details className="mt-2 rounded-lg bg-zinc-900/40 px-3 py-2">
                      <summary className="cursor-pointer text-xs text-amber-400">
                        {t.settings.sourceManager.viewErrors} ({scan.errors.length})
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {scan.errors.map((error) => (
                          <li
                            key={error.id}
                            className="font-mono text-[11px] leading-relaxed text-zinc-500"
                          >
                            {error.errorMessage}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </SettingsCard>

      <Modal
        isOpen={!!removalTarget}
        onClose={() => setRemovalTarget(null)}
        size="sm"
        title={
          removalTarget?.kind === 'drive'
            ? t.settings.scan.disconnectTitle
            : t.settings.localLibrary.removeTitle
        }
        description={
          removalTarget?.kind === 'drive'
            ? removalTarget.source.folderName || removalTarget.source.googleAccountEmail
            : removalTarget?.library.name
        }
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
              icon={Trash2}
              onClick={handleRemove}
              isLoading={isRemoving}
            >
              {removalTarget?.kind === 'drive'
                ? t.settings.scan.disconnectConfirm
                : t.settings.localLibrary.removeConfirm}
            </SettingsButton>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          {removalTarget?.kind === 'drive'
            ? t.settings.scan.disconnectBody(
                removalTarget.source.folderName ||
                  removalTarget.source.rootFolderId ||
                  t.settings.sourceManager.entireDrive,
              )
            : t.settings.localLibrary.removeBody(removalTarget?.library.localFolderPath || '')}
        </p>
      </Modal>
    </>
  );
};

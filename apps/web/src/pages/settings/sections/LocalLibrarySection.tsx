import React, { useId, useState } from 'react';
import { AlertTriangle, HardDrive, Folder, FolderPlus, RefreshCw, Trash2 } from 'lucide-react';
import type { LibraryDto } from '@cinedrive/shared';
import {
  useLibrariesQuery,
  useCreateLibraryMutation,
  useDeleteLibraryMutation,
  useScanLibraryMutation,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { Modal } from '../../../components/common/Modal';
import {
  SettingsButton,
  SettingsCard,
  SettingsField,
  SETTINGS_INPUT_CLASSES,
} from '../SettingsCard';
import { t } from '../../../i18n';

export const LocalLibrarySection: React.FC = () => {
  const fieldId = useId();
  const { data: libraries } = useLibrariesQuery();
  const createLibrary = useCreateLibraryMutation();
  const deleteLibrary = useDeleteLibraryMutation();
  const scanLibrary = useScanLibraryMutation();

  const [name, setName] = useState('');
  const [localFolderPath, setLocalFolderPath] = useState('');
  const [libraryToRemove, setLibraryToRemove] = useState<LibraryDto | null>(null);

  const localLibraries = libraries?.filter((library) => library.storageType === 'local') || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(t.settings.localLibrary.missingName);
      return;
    }
    if (!localFolderPath.trim()) {
      toast.error(t.settings.localLibrary.missingPath);
      return;
    }

    try {
      const newLibrary = await createLibrary.mutateAsync({
        name: name.trim(),
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: localFolderPath.trim(),
      });

      toast.success(t.settings.localLibrary.created(name));
      setName('');
      setLocalFolderPath('');
      scanLibrary.mutate(newLibrary.id);
    } catch (error) {
      toast.fromError(error, t.settings.localLibrary.createFailed);
    }
  };

  const handleRemove = async () => {
    if (!libraryToRemove) return;
    try {
      const removed = await deleteLibrary.mutateAsync(libraryToRemove.id);
      toast.success(t.settings.localLibrary.removed(removed.files));
      setLibraryToRemove(null);
    } catch (error) {
      toast.fromError(error, t.settings.localLibrary.removeFailed);
    }
  };

  return (
    <SettingsCard
      id="settings-local-library"
      title={t.settings.localLibrary.title}
      description={t.settings.localLibrary.description}
      icon={HardDrive}
      width="full"
    >
      <div className="space-y-6">
        {localLibraries.length > 0 && (
          <ul className="divide-y divide-zinc-800/60 border-y border-zinc-800/60">
            {localLibraries.map((library) => (
              <li key={library.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Folder className="h-4 w-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-zinc-200">
                      {library.name}
                    </p>
                    <p className="truncate font-mono text-xs text-zinc-500">
                      {library.localFolderPath}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => scanLibrary.mutate(library.id)}
                    disabled={scanLibrary.isPending || deleteLibrary.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${scanLibrary.isPending ? 'animate-spin' : ''}`}
                    />
                    {t.settings.localLibrary.scanFolder}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryToRemove(library)}
                    disabled={scanLibrary.isPending || deleteLibrary.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t.settings.localLibrary.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleCreate} className="max-w-xl space-y-4">
          <h4 className="text-[13px] font-medium text-zinc-300">
            {t.settings.localLibrary.addNew}
          </h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SettingsField id={`${fieldId}-name`} label={t.settings.localLibrary.name}>
              <input
                id={`${fieldId}-name`}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.settings.localLibrary.namePlaceholder}
                className={SETTINGS_INPUT_CLASSES}
              />
            </SettingsField>

            <SettingsField id={`${fieldId}-path`} label={t.settings.localLibrary.path}>
              <input
                id={`${fieldId}-path`}
                type="text"
                value={localFolderPath}
                onChange={(e) => setLocalFolderPath(e.target.value)}
                placeholder={t.settings.localLibrary.pathPlaceholder}
                className={`${SETTINGS_INPUT_CLASSES} font-mono`}
              />
            </SettingsField>
          </div>

          <SettingsButton
            type="submit"
            icon={FolderPlus}
            disabled={!name.trim() || !localFolderPath.trim()}
            isLoading={createLibrary.isPending}
            loadingLabel={t.settings.localLibrary.creating}
          >
            {t.settings.localLibrary.create}
          </SettingsButton>
        </form>
      </div>

      <Modal
        isOpen={!!libraryToRemove}
        onClose={() => setLibraryToRemove(null)}
        size="sm"
        title={t.settings.localLibrary.removeTitle}
        description={libraryToRemove?.name}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <SettingsButton variant="secondary" onClick={() => setLibraryToRemove(null)}>
              {t.common.cancel}
            </SettingsButton>
            <SettingsButton
              variant="danger"
              icon={Trash2}
              onClick={handleRemove}
              isLoading={deleteLibrary.isPending}
            >
              {t.settings.localLibrary.removeConfirm}
            </SettingsButton>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          {t.settings.localLibrary.removeBody(libraryToRemove?.localFolderPath || '')}
        </p>
      </Modal>
    </SettingsCard>
  );
};

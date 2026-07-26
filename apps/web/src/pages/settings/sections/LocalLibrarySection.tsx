import React, { useId, useState } from 'react';
import { HardDrive, Folder, FolderPlus, RefreshCw } from 'lucide-react';
import {
  useLibrariesQuery,
  useCreateLibraryMutation,
  useScanLibraryMutation,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
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
  const scanLibrary = useScanLibraryMutation();

  const [name, setName] = useState('');
  const [localFolderPath, setLocalFolderPath] = useState('');

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
                <button
                  type="button"
                  onClick={() => scanLibrary.mutate(library.id)}
                  disabled={scanLibrary.isPending}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${scanLibrary.isPending ? 'animate-spin' : ''}`}
                  />
                  {t.settings.localLibrary.scanFolder}
                </button>
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
    </SettingsCard>
  );
};

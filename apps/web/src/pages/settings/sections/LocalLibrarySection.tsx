import React, { useId, useState } from 'react';
import { HardDrive, Folder, FolderPlus, RefreshCw, Loader2 } from 'lucide-react';
import { useLibrariesQuery, useCreateLibraryMutation, useScanLibraryMutation } from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { SettingsCard, SettingsField, SETTINGS_INPUT_CLASSES } from '../SettingsCard';
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
      icon={
        <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400">
          <HardDrive className="h-5 w-5" />
        </div>
      }
    >
      {localLibraries.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-zinc-300">{t.settings.localLibrary.existing}</h4>
          <ul className="grid grid-cols-1 gap-3">
            {localLibraries.map((library) => (
              <li
                key={library.id}
                className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Folder className="h-5 w-5 flex-shrink-0 text-emerald-400" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{library.name}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-400">
                      {library.localFolderPath}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => scanLibrary.mutate(library.id)}
                  disabled={scanLibrary.isPending}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-all hover:bg-emerald-600 hover:text-white"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${scanLibrary.isPending ? 'animate-spin' : ''}`}
                  />
                  <span>{t.settings.localLibrary.scanFolder}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-300">
          <FolderPlus className="h-4 w-4 text-brand-400" />
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

        <button
          type="submit"
          disabled={createLibrary.isPending || !name.trim() || !localFolderPath.trim()}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 disabled:opacity-40"
        >
          {createLibrary.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t.settings.localLibrary.creating}</span>
            </>
          ) : (
            <>
              <FolderPlus className="h-4 w-4" />
              <span>{t.settings.localLibrary.create}</span>
            </>
          )}
        </button>
      </form>
    </SettingsCard>
  );
};

import React, { useState } from 'react';
import { Database, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useLibrariesQuery, useClearLibraryMutation } from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { Modal } from '../../../components/common/Modal';
import { SettingsCard } from '../SettingsCard';
import { t } from '../../../i18n';

export const DatabaseSection: React.FC = () => {
  const { data: libraries } = useLibrariesQuery();
  const activeLibrary = libraries?.[0];
  const clearLibrary = useClearLibraryMutation();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClear = async () => {
    if (!activeLibrary) return;
    try {
      await clearLibrary.mutateAsync(activeLibrary.id);
      setShowConfirm(false);
      toast.success(t.settings.database.cleared);
    } catch (error) {
      toast.fromError(error, t.settings.database.clearFailed);
    }
  };

  return (
    <>
      <SettingsCard
        id="settings-database"
        tone="danger"
        title={t.settings.database.title}
        description={t.settings.database.description}
        icon={
          <div className="rounded-xl bg-rose-500/20 p-2.5 text-rose-400">
            <Database className="h-5 w-5" />
          </div>
        }
      >
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-zinc-200">
              {t.settings.database.clearTitle}
            </h4>
            <p className="max-w-xl text-xs leading-relaxed text-zinc-400">
              {t.settings.database.clearDescription}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={!activeLibrary || clearLibrary.isPending}
            className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-rose-600/90 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition-all hover:bg-rose-500 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            {t.settings.database.clearAction}
          </button>
        </div>
      </SettingsCard>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        size="sm"
        title={t.settings.database.confirmTitle}
        description={t.settings.database.confirmSubtitle}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="rounded-xl bg-zinc-800 px-5 py-2.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-700"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={clearLibrary.isPending}
              className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition-all hover:bg-rose-500 disabled:opacity-50"
            >
              {clearLibrary.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.settings.database.clearing}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {t.settings.database.confirmAction}
                </>
              )}
            </button>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          {t.settings.database.confirmBody}
        </p>
      </Modal>
    </>
  );
};

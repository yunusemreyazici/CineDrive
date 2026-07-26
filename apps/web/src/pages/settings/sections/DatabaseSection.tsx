import React, { useState } from 'react';
import { Database, Trash2, AlertTriangle } from 'lucide-react';
import { useLibrariesQuery, useClearLibraryMutation } from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { Modal } from '../../../components/common/Modal';
import { SettingsButton, SettingsCard, SettingsRow } from '../SettingsCard';
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
        icon={Database}
      >
        <SettingsRow
          title={t.settings.database.clearTitle}
          description={t.settings.database.clearDescription}
        >
          <SettingsButton
            variant="danger"
            icon={Trash2}
            onClick={() => setShowConfirm(true)}
            disabled={!activeLibrary}
            isLoading={clearLibrary.isPending}
          >
            {t.settings.database.clearAction}
          </SettingsButton>
        </SettingsRow>
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
          <div className="flex items-center justify-end gap-2">
            <SettingsButton variant="secondary" onClick={() => setShowConfirm(false)}>
              {t.common.cancel}
            </SettingsButton>
            <SettingsButton
              variant="danger"
              icon={Trash2}
              onClick={handleClear}
              isLoading={clearLibrary.isPending}
              loadingLabel={t.settings.database.clearing}
            >
              {t.settings.database.confirmAction}
            </SettingsButton>
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

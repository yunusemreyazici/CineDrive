import React, { useState } from 'react';
import { Database, Trash2, AlertTriangle, Eraser } from 'lucide-react';
import {
  useClearDatabaseMutation,
  useDatabaseStatsQuery,
  useDatabaseCleanupMutation,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { Modal } from '../../../components/common/Modal';
import {
  SettingsButton,
  SettingsCard,
  SettingsMetric,
  SettingsRow,
} from '../SettingsCard';
import { t } from '../../../i18n';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

export const DatabaseStatsSection: React.FC = () => {
  const { data: stats, error } = useDatabaseStatsQuery();
  const cleanup = useDatabaseCleanupMutation();

  const handleCleanup = async () => {
    try {
      const removed = await cleanup.mutateAsync();
      toast.success(t.settings.database.cleanupDone(removed.media, removed.staleScans));
    } catch (cleanupError) {
      toast.fromError(cleanupError, t.settings.database.cleanupFailed);
    }
  };

  return (
    <SettingsCard
      id="settings-database-stats"
      title={t.settings.database.statsTitle}
      description={t.settings.database.description}
      icon={Database}
      width="full"
    >
      {error ? (
        <p className="text-[13px] text-zinc-500">{t.settings.database.statsFailed}</p>
      ) : !stats ? (
        <div className="h-16 animate-pulse rounded-lg bg-zinc-900/60" />
      ) : (
        <div className="space-y-6">
          {/* The screen offered destructive actions without ever showing what
              was in the database they act on. */}
          <div className="grid grid-cols-3 gap-x-8 gap-y-5 sm:grid-cols-5 lg:grid-cols-9">
            <SettingsMetric label={t.settings.database.statLibraries} value={stats.libraries} />
            <SettingsMetric label={t.settings.database.statFiles} value={stats.driveFiles} />
            <SettingsMetric label={t.settings.database.statMovies} value={stats.movies} />
            <SettingsMetric label={t.settings.database.statSeries} value={stats.series} />
            <SettingsMetric label={t.settings.database.statEpisodes} value={stats.episodes} />
            <SettingsMetric label={t.settings.database.statSubtitles} value={stats.subtitles} />
            <SettingsMetric label={t.settings.database.statHistory} value={stats.watchHistory} />
            <SettingsMetric label={t.settings.database.statFavorites} value={stats.favorites} />
            <SettingsMetric
              label={t.settings.database.statSize}
              value={formatBytes(stats.sizeBytes)}
            />
          </div>

          <SettingsRow
            title={t.settings.database.orphanTitle}
            description={
              <>
                {t.settings.database.orphanDescription}{' '}
                <span className={stats.orphanMedia > 0 ? 'text-amber-400' : undefined}>
                  {stats.orphanMedia > 0
                    ? t.settings.database.orphanCount(stats.orphanMedia)
                    : t.settings.database.orphanNone}
                </span>
              </>
            }
          >
            <SettingsButton
              variant="secondary"
              icon={Eraser}
              onClick={handleCleanup}
              disabled={stats.orphanMedia === 0 && stats.scans === 0}
              isLoading={cleanup.isPending}
              loadingLabel={t.settings.database.cleaningUp}
            >
              {t.settings.database.cleanup}
            </SettingsButton>
          </SettingsRow>
        </div>
      )}
    </SettingsCard>
  );
};

export const DatabaseSection: React.FC = () => {
  const clearDatabase = useClearDatabaseMutation();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClear = async () => {
    try {
      const result = await clearDatabase.mutateAsync();
      setShowConfirm(false);
      toast.success(
        `${t.settings.database.cleared} ${t.settings.database.clearedCount(
          result.removed.media,
          result.removed.files,
        )}`,
      );
    } catch (error) {
      toast.fromError(error, t.settings.database.clearFailed);
    }
  };

  return (
    <>
      <SettingsCard
        id="settings-database"
        tone="danger"
        title={t.settings.database.libraryClearTitle}
        description={t.settings.database.libraryClearDescription}
        icon={Database}
      >
        <div>
          <SettingsButton
            variant="danger"
            icon={Trash2}
            onClick={() => setShowConfirm(true)}
            isLoading={clearDatabase.isPending}
          >
            {t.settings.database.clearAction}
          </SettingsButton>
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
          <div className="flex items-center justify-end gap-2">
            <SettingsButton variant="secondary" onClick={() => setShowConfirm(false)}>
              {t.common.cancel}
            </SettingsButton>
            <SettingsButton
              variant="danger"
              icon={Trash2}
              onClick={handleClear}
              isLoading={clearDatabase.isPending}
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

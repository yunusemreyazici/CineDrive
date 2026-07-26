import React, { useId, useState } from 'react';
import { Save, Film, Calendar, FileText, Image, Star, Loader2 } from 'lucide-react';
import type { MediaItemType } from '../types/media';
import { useUpdateMediaMetadataMutation } from '../hooks/useApi';
import { Modal } from './common/Modal';
import { t } from '../i18n';

interface EditMetadataModalProps {
  media: MediaItemType;
  isOpen: boolean;
  onClose: () => void;
}

const FIELD_CLASSES =
  'w-full rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-4 py-2.5 text-sm text-white transition-all focus:border-brand-500 focus:outline-none';
const LABEL_CLASSES =
  'mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-300';

export const EditMetadataModal: React.FC<EditMetadataModalProps> = ({
  media,
  isOpen,
  onClose,
}) => {
  const updateMutation = useUpdateMediaMetadataMutation();
  const fieldId = useId();

  const [title, setTitle] = useState(media.title || '');
  const [year, setYear] = useState<number | string>(media.year || '');
  const [overview, setOverview] = useState(media.overview || '');
  const [posterUrl, setPosterUrl] = useState(media.posterUrl || '');
  const [backdropUrl, setBackdropUrl] = useState(media.backdropUrl || '');
  const [voteAverage, setVoteAverage] = useState<number | string>(
    media.voteAverage !== undefined && media.voteAverage !== null ? media.voteAverage : '',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    try {
      await updateMutation.mutateAsync({
        id: media.id,
        data: {
          title: title.trim(),
          year: year !== '' ? Number(year) : null,
          overview: overview.trim() || null,
          posterUrl: posterUrl.trim() || null,
          backdropUrl: backdropUrl.trim() || null,
          voteAverage: voteAverage !== '' ? Number(voteAverage) : null,
        },
      });
      onClose();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String(err.message)
          : t.metadataEditor.updateFailed;
      setErrorMsg(msg);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t.mediaDetail.editTitle}
      description={t.metadataEditor.description}
      icon={
        <div className="rounded-xl bg-brand-600/20 p-2.5 text-brand-400">
          <Film className="h-5 w-5" />
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        {errorMsg && (
          <div
            role="alert"
            className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400"
          >
            {errorMsg}
          </div>
        )}

        {/* Title */}
        <div>
          <label htmlFor={`${fieldId}-title`} className={LABEL_CLASSES}>
            <Film className="h-3.5 w-3.5 text-brand-400" />
            {t.metadataEditor.title}
          </label>
          <input
            id={`${fieldId}-title`}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={FIELD_CLASSES}
            placeholder={t.metadataEditor.titlePlaceholder}
          />
        </div>

        {/* Year & Rating */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${fieldId}-year`} className={LABEL_CLASSES}>
              <Calendar className="h-3.5 w-3.5 text-brand-400" />
              {t.metadataEditor.year}
            </label>
            <input
              id={`${fieldId}-year`}
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={FIELD_CLASSES}
              placeholder={t.metadataEditor.yearPlaceholder}
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-rating`} className={LABEL_CLASSES}>
              <Star className="h-3.5 w-3.5 text-amber-400" />
              {t.metadataEditor.rating}
            </label>
            <input
              id={`${fieldId}-rating`}
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={voteAverage}
              onChange={(e) => setVoteAverage(e.target.value)}
              className={FIELD_CLASSES}
              placeholder={t.metadataEditor.ratingPlaceholder}
            />
          </div>
        </div>

        {/* Overview */}
        <div>
          <label htmlFor={`${fieldId}-overview`} className={LABEL_CLASSES}>
            <FileText className="h-3.5 w-3.5 text-brand-400" />
            {t.metadataEditor.overview}
          </label>
          <textarea
            id={`${fieldId}-overview`}
            rows={3}
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            className={`${FIELD_CLASSES} resize-none`}
            placeholder={t.metadataEditor.overviewPlaceholder}
          />
        </div>

        {/* Poster URL */}
        <div>
          <label htmlFor={`${fieldId}-poster`} className={LABEL_CLASSES}>
            <Image className="h-3.5 w-3.5 text-brand-400" />
            {t.metadataEditor.posterUrl}
          </label>
          <input
            id={`${fieldId}-poster`}
            type="url"
            value={posterUrl}
            onChange={(e) => setPosterUrl(e.target.value)}
            className={FIELD_CLASSES}
            placeholder="https://image.tmdb.org/t/p/w500/..."
          />
        </div>

        {/* Backdrop URL */}
        <div>
          <label htmlFor={`${fieldId}-backdrop`} className={LABEL_CLASSES}>
            <Image className="h-3.5 w-3.5 text-brand-400" />
            {t.metadataEditor.backdropUrl}
          </label>
          <input
            id={`${fieldId}-backdrop`}
            type="url"
            value={backdropUrl}
            onChange={(e) => setBackdropUrl(e.target.value)}
            className={FIELD_CLASSES}
            placeholder="https://image.tmdb.org/t/p/original/..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-zinc-800 px-5 py-2.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-700"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-500 disabled:opacity-50"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.common.saving}
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {t.metadataEditor.saveChanges}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};

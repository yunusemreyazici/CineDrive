import React, { useState } from 'react';
import { X, Save, Film, Calendar, FileText, Image, Star, Loader2 } from 'lucide-react';
import type { MediaItemType } from '../types/media';
import { useUpdateMediaMetadataMutation } from '../hooks/useApi';

interface EditMetadataModalProps {
  media: MediaItemType;
  isOpen: boolean;
  onClose: () => void;
}

export const EditMetadataModal: React.FC<EditMetadataModalProps> = ({
  media,
  isOpen,
  onClose,
}) => {
  const updateMutation = useUpdateMediaMetadataMutation();

  const [title, setTitle] = useState(media.title || '');
  const [year, setYear] = useState<number | string>(media.year || '');
  const [overview, setOverview] = useState(media.overview || '');
  const [posterUrl, setPosterUrl] = useState(media.posterUrl || '');
  const [backdropUrl, setBackdropUrl] = useState(media.backdropUrl || '');
  const [voteAverage, setVoteAverage] = useState<number | string>(
    media.voteAverage !== undefined && media.voteAverage !== null ? media.voteAverage : '',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

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
      const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Metadata güncellenirken bir hata oluştu.';
      setErrorMsg(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden p-6 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-600/20 text-brand-400 rounded-xl">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-white">Metadata Düzenle</h3>
              <p className="text-xs text-zinc-400">İçerik başlığı, açıklaması ve görsellerini güncelleyin</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-400">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5 text-brand-400" />
              İçerik Başlığı
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all"
              placeholder="Örn: Inception"
            />
          </div>

          {/* Year & Rating */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-brand-400" />
                Yapım Yılı
              </label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all"
                placeholder="Örn: 2010"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-amber-400" />
                IMDb / Puan (0-10)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={voteAverage}
                onChange={(e) => setVoteAverage(e.target.value)}
                className="w-full px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all"
                placeholder="Örn: 8.8"
              />
            </div>
          </div>

          {/* Overview */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-brand-400" />
              Özet / Açıklama
            </label>
            <textarea
              rows={3}
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              className="w-full px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all resize-none"
              placeholder="Film veya dizi özetini girin..."
            />
          </div>

          {/* Poster URL */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <Image className="w-3.5 h-3.5 text-brand-400" />
              Afiş (Poster) Görsel URL
            </label>
            <input
              type="url"
              value={posterUrl}
              onChange={(e) => setPosterUrl(e.target.value)}
              className="w-full px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all"
              placeholder="https://image.tmdb.org/t/p/w500/..."
            />
          </div>

          {/* Backdrop URL */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <Image className="w-3.5 h-3.5 text-brand-400" />
              Arka Plan (Backdrop) Görsel URL
            </label>
            <input
              type="url"
              value={backdropUrl}
              onChange={(e) => setBackdropUrl(e.target.value)}
              className="w-full px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm text-white focus:outline-none focus:border-brand-500 transition-all"
              placeholder="https://image.tmdb.org/t/p/original/..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all disabled:opacity-50"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Kaydediliyor...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Değişiklikleri Kaydet
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

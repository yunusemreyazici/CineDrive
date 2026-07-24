import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Dices, Play, Info, X, Star, Film, Tv, Sparkles, RefreshCw } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { MediaItemType } from '../../types/media';

interface RandomPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RandomPickerModal: React.FC<RandomPickerModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<'all' | 'movie' | 'series'>('all');
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [isRolling, setIsRolling] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItemType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRandomMedia = async () => {
    setIsRolling(true);
    setError(null);

    try {
      const params: Record<string, string | number> = {};
      if (typeFilter !== 'all') params.type = typeFilter;
      if (minRating) params.minRating = minRating;

      // Small delay for dice rolling animation effect
      await new Promise((resolve) => setTimeout(resolve, 600));

      const res = await apiClient.get<{ media: MediaItemType }>('/media/random', { params });
      setSelectedMedia(res.data.media);
    } catch {
      setError('Kriterlerinize uygun medya bulunamadı.');
      setSelectedMedia(null);
    } finally {
      setIsRolling(false);
    }
  };

  useEffect(() => {
    if (isOpen && !selectedMedia && !isRolling) {
      fetchRandomMedia();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col my-auto animate-scale-up"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-600/20 text-brand-400 rounded-2xl border border-brand-500/30">
              <Dices className={`w-6 h-6 ${isRolling ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white font-display">Ne İzlesem? Zarı 🎲</h3>
              <p className="text-xs text-zinc-400">Kararsız kaldığınızda kütüphaneden rastgele öneri alın</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 bg-zinc-900/40 border-b border-zinc-800/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex p-1 bg-zinc-950 border border-zinc-800 rounded-xl text-xs">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-3 py-1.5 font-medium rounded-lg transition-all ${
                  typeFilter === 'all' ? 'bg-brand-600 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Tümü
              </button>
              <button
                onClick={() => setTypeFilter('movie')}
                className={`px-3 py-1.5 font-medium rounded-lg transition-all ${
                  typeFilter === 'movie' ? 'bg-brand-600 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Filmler
              </button>
              <button
                onClick={() => setTypeFilter('series')}
                className={`px-3 py-1.5 font-medium rounded-lg transition-all ${
                  typeFilter === 'series' ? 'bg-brand-600 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Diziler
              </button>
            </div>

            <select
              value={minRating || 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? undefined : parseFloat(e.target.value);
                setMinRating(val);
              }}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-300 focus:border-brand-500 focus:outline-none"
            >
              <option value="all">Tüm IMDb Puanları</option>
              <option value="7.0">★ 7.0+ Üzeri</option>
              <option value="8.0">★ 8.0+ Üzeri</option>
            </select>
          </div>

          <button
            onClick={fetchRandomMedia}
            disabled={isRolling}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-brand-500/20 transition-all hover:scale-105 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRolling ? 'animate-spin' : ''}`} />
            <span>{isRolling ? 'Zar Atılıyor...' : 'Zar At'}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 min-h-[260px] flex items-center justify-center">
          {isRolling ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-brand-600/20 text-brand-400 flex items-center justify-center border border-brand-500/40 shadow-xl shadow-brand-500/20 animate-bounce">
                <Dices className="w-10 h-10 animate-spin" />
              </div>
              <p className="text-sm font-semibold text-zinc-300 font-display animate-pulse">
                Kütüphaneden şansınıza özel içerik seçiliyor...
              </p>
            </div>
          ) : error ? (
            <div className="text-center py-8 text-zinc-400 space-y-2">
              <p className="text-sm font-medium text-rose-400">{error}</p>
              <p className="text-xs text-zinc-500">Lütfen filtre kriterlerini değiştirip tekrar zar atın.</p>
            </div>
          ) : selectedMedia ? (
            <div className="w-full flex flex-col md:flex-row items-center gap-6">
              {/* Media Poster */}
              <div className="w-36 md:w-44 aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 flex-shrink-0 shadow-xl relative group">
                {selectedMedia.posterUrl ? (
                  <img
                    src={selectedMedia.posterUrl}
                    alt={selectedMedia.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-700">
                    {selectedMedia.type === 'movie' ? <Film className="w-10 h-10" /> : <Tv className="w-10 h-10" />}
                  </div>
                )}
                {selectedMedia.voteAverage && (
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-amber-500/30 text-amber-400 text-xs font-bold flex items-center gap-1">
                    <Star className="w-3 h-3 fill-current" />
                    {selectedMedia.voteAverage.toFixed(1)}
                  </div>
                )}
              </div>

              {/* Media Information */}
              <div className="flex-1 space-y-3 text-center md:text-left">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-brand-600/20 text-brand-400 text-[11px] font-bold uppercase tracking-wider">
                  <Sparkles className="w-3 h-3" />
                  Sizin İçin Seçilen İçerik
                </div>

                <h4 className="text-2xl font-extrabold text-white font-display">
                  {selectedMedia.title}
                </h4>

                <div className="flex items-center justify-center md:justify-start gap-3 text-xs text-zinc-400 font-medium">
                  <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 uppercase">
                    {selectedMedia.type === 'movie' ? 'Film' : 'Dizi'}
                  </span>
                  {selectedMedia.year && <span>{selectedMedia.year}</span>}
                  {selectedMedia.genres && selectedMedia.genres.length > 0 && (
                    <span>• {selectedMedia.genres.slice(0, 2).join(', ')}</span>
                  )}
                </div>

                {selectedMedia.overview && (
                  <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed">
                    {selectedMedia.overview}
                  </p>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/watch/${selectedMedia.id}`);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-brand-500/25 transition-all hover:scale-105"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Şimdi Oynat</span>
                  </button>

                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/media/${selectedMedia.id}`);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-semibold rounded-xl border border-zinc-800 transition-all hover:scale-105"
                  >
                    <Info className="w-4 h-4" />
                    <span>Detaylar</span>
                  </button>

                  <button
                    onClick={fetchRandomMedia}
                    className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all"
                  >
                    <Dices className="w-4 h-4 text-brand-400" />
                    <span>Başka Öner</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

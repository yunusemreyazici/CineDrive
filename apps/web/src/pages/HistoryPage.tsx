import React from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Play, Trash2 } from 'lucide-react';
import { useWatchHistoryQuery, useDeleteHistoryMutation } from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: history, isLoading } = useWatchHistoryQuery();
  const deleteHistory = useDeleteHistoryMutation();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-2xl">
          <History className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">İzleme Geçmişi</h2>
          <p className="text-sm text-zinc-400 mt-0.5">Son izlediğiniz film ve dizi bölümleri</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-zinc-900 rounded-2xl" />
          ))}
        </div>
      ) : !history || history.length === 0 ? (
        <EmptyState
          icon={History}
          title="İzleme Geçmişi Boş"
          description="İzlediğiniz filmler ve diziler tarih sırasıyla burada görünecektir."
        />
      ) : (
        <div className="space-y-3">
          {history.map((item) => {
            const media = item.mediaItem;
            const posterUrl = media.posterDriveFileId
              ? `/api/media/assets/${media.posterDriveFileId}`
              : null;

            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/60 rounded-2xl transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 aspect-[2/3] bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0">
                    {posterUrl && <img src={posterUrl} alt={media.title} className="w-full h-full object-cover" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-100 font-display">{media.title}</h4>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {new Date(item.watchedAt).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigate(`/watch/${media.id}`)}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-brand-500/20"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Devam Et
                  </button>
                  <button
                    onClick={() => deleteHistory.mutate(item.id)}
                    aria-label="Geçmişten Kaldır"
                    className="p-2 rounded-xl bg-zinc-800/60 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 border border-zinc-700/50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

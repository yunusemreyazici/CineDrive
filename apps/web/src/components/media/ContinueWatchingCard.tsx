import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Info, Film, Tv, X } from 'lucide-react';
import { useResetProgressMutation, type ContinueWatchingItemType } from '../../hooks/useApi';
import { formatMediaTitle } from '../../utils/formatMediaTitle';

interface ContinueWatchingCardProps {
  item: ContinueWatchingItemType;
}

export const ContinueWatchingCard: React.FC<ContinueWatchingCardProps> = ({ item }) => {
  const navigate = useNavigate();
  const resetProgress = useResetProgressMutation();

  const media = item.mediaItem;
  if (!media) return null;

  const backdropUrl =
    media.backdropUrl ||
    media.posterUrl ||
    (media.backdropDriveFileId ? `/api/media/assets/${media.backdropDriveFileId}` : null);

  const remainingSeconds = Math.max(0, item.durationSeconds - item.positionSeconds);
  const remainingMins = Math.ceil(remainingSeconds / 60);

  let episodeInfo: string | null = null;
  if (item.episode) {
    const sNum = item.episode.seasonNumber;
    const eNum = item.episode.episodeNumber;
      episodeInfo = `S${sNum < 10 ? `0${sNum}` : sNum}E${eNum < 10 ? `0${eNum}` : eNum}`;
    if (item.episode.title) {
      episodeInfo += ` · ${item.episode.title}`;
    }
  }

  const handlePlayClick = () => {
    if (item.episodeId) {
      navigate(`/watch/${media.id}/${item.episodeId}`);
    } else {
      navigate(`/watch/${media.id}`);
    }
  };

  return (
    <div
      onClick={handlePlayClick}
      className="group relative flex w-[280px] shrink-0 snap-start cursor-pointer flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#111214] transition duration-300 hover:scale-[1.025] hover:bg-[#181a1d] hover:shadow-[0_18px_42px_rgba(0,0,0,0.35)]"
    >
      {/* 16:9 Landscape Media Image Container */}
      <div className="relative aspect-video w-full bg-zinc-950 overflow-hidden">
        {backdropUrl ? (
          <img
            src={backdropUrl}
            alt={media.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800/80 via-zinc-900 to-black text-zinc-600">
            {media.type === 'movie' ? <Film className="w-8 h-8" /> : <Tv className="w-8 h-8" />}
          </div>
        )}

        {/* Dark Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />

        {/* Center Hover Play Button */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <button
            type="button"
            aria-label={`${media.title} izlemeye devam listesinden kaldır`}
            onClick={(event) => {
              event.stopPropagation();
              resetProgress.mutate(media.id);
            }}
            disabled={resetProgress.isPending}
            className="flex h-8 w-8 translate-y-1 items-center justify-center rounded-full border border-white/25 bg-black/65 text-zinc-200 opacity-0 backdrop-blur transition hover:border-red-400/60 hover:text-red-300 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`${media.title} detayları`}
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/media/${media.id}`);
            }}
            className="flex h-8 w-8 translate-y-1 items-center justify-center rounded-full border border-white/25 bg-black/65 text-zinc-200 opacity-0 backdrop-blur transition group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/45 bg-zinc-950/75 text-white shadow-lg backdrop-blur-md transition group-hover:border-brand-400 group-hover:bg-brand-600">
            <Play className="h-4 w-4 translate-x-px fill-current" />
          </div>
        </div>

      </div>

      {/* Card Details Body */}
      <div className="flex flex-1 flex-col justify-between space-y-1.5 p-3">
        <div>
          <h4 className="truncate text-sm font-semibold text-white transition-colors group-hover:text-brand-400">
            {formatMediaTitle(media.title)}
          </h4>

        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-zinc-400">
            {episodeInfo ? `${episodeInfo} · ` : ''}
            {remainingMins > 0 ? `${remainingMins} dk kaldı` : 'Neredeyse bitti'}
          </p>
          <span className="shrink-0 text-[10px] font-bold text-brand-400 opacity-0 transition group-hover:opacity-100">
            %{Math.round(item.percentage)}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
          />
        </div>
      </div>
    </div>
  );
};

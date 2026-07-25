import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Clock, Film, Tv } from 'lucide-react';
import type { ContinueWatchingItemType } from '../../hooks/useApi';

interface ContinueWatchingCardProps {
  item: ContinueWatchingItemType;
}

export const ContinueWatchingCard: React.FC<ContinueWatchingCardProps> = ({ item }) => {
  const navigate = useNavigate();

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
      episodeInfo += ` • ${item.episode.title}`;
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
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900/70 transition duration-300 hover:-translate-y-1 hover:border-brand-500/45 hover:shadow-[0_20px_48px_rgba(0,0,0,0.35)]"
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
          <div className="w-full h-full flex items-center justify-center text-zinc-700">
            {media.type === 'movie' ? <Film className="w-8 h-8" /> : <Tv className="w-8 h-8" />}
          </div>
        )}

        {/* Dark Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />

        {/* Center Hover Play Button */}
        <div className="absolute bottom-3 right-3 flex items-center justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-brand-400/50 bg-zinc-950/75 text-brand-400 shadow-lg backdrop-blur-md transition group-hover:bg-brand-600 group-hover:text-white">
            <Play className="h-4 w-4 translate-x-px fill-current" />
          </div>
        </div>

        {/* Progress Bar along the bottom of the image */}
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800">
          <div
            className="h-full bg-brand-500 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
          />
        </div>
      </div>

      {/* Card Details Body */}
      <div className="flex flex-1 flex-col justify-between space-y-2 p-3.5">
        <div>
          <h4 className="truncate text-sm font-semibold text-white transition-colors group-hover:text-brand-400">
            {media.title}
          </h4>

          {episodeInfo && (
            <p className="text-xs text-zinc-400 font-medium truncate mt-0.5">{episodeInfo}</p>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1 text-zinc-400">
            <Clock className="w-3 h-3 text-brand-400" />
            {remainingMins > 0 ? `${remainingMins} dk kaldı` : 'Neredeyse bitti'}
          </span>
          <span className="text-brand-400 font-bold">%{Math.round(item.percentage)}</span>
        </div>
      </div>
    </div>
  );
};

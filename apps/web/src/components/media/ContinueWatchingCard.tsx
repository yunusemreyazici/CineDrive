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
      className="group relative bg-zinc-900 border border-zinc-800/80 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:border-brand-500/50 hover:shadow-xl hover:shadow-brand-500/10 flex flex-col"
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

        {/* Center Hover Play Button */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-brand-600/90 text-white flex items-center justify-center shadow-lg shadow-brand-500/30 transform transition-all duration-300 group-hover:scale-110 group-hover:bg-brand-500">
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </div>
        </div>

        {/* Top Type Badge */}
        <div className="absolute top-2.5 left-2.5">
          <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-bold text-zinc-300 border border-white/10 uppercase tracking-wider">
            {media.type === 'movie' ? 'Film' : 'Dizi'}
          </span>
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
      <div className="p-3.5 flex flex-col justify-between flex-1 space-y-1.5">
        <div>
          <h4 className="text-sm font-bold text-white font-display truncate group-hover:text-brand-400 transition-colors">
            {media.title}
          </h4>

          {episodeInfo && (
            <p className="text-xs text-zinc-400 font-medium truncate mt-0.5">{episodeInfo}</p>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 font-mono">
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

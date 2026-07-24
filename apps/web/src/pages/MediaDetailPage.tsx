import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Heart, Clock, Film, Tv, CheckCircle2 } from 'lucide-react';
import { useMediaDetailQuery, useToggleFavoriteMutation } from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import type { SeasonType, EpisodeType } from '../types/media';

export const MediaDetailPage: React.FC = () => {
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const { data: media, isLoading } = useMediaDetailQuery(mediaId);
  const toggleFavorite = useToggleFavoriteMutation();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="w-full h-80 bg-zinc-900 rounded-3xl" />
        <div className="h-8 bg-zinc-900 rounded-xl w-1/3" />
        <div className="h-20 bg-zinc-900 rounded-xl w-2/3" />
      </div>
    );
  }

  if (!media) {
    return (
      <EmptyState
        title="İçerik Bulunamadı"
        description="Aradığınız medya dosyası silinmiş veya erişilemiyor olabilir."
        actionLabel="Kütüphaneye Dön"
        onAction={() => navigate('/library')}
      />
    );
  }

  const backdropUrl =
    (media as { backdropUrl?: string; posterUrl?: string }).backdropUrl ||
    (media as { backdropUrl?: string; posterUrl?: string }).posterUrl ||
    (media.backdropDriveFileId
      ? `/api/media/assets/${media.backdropDriveFileId}`
      : media.posterDriveFileId
        ? `/api/media/assets/${media.posterDriveFileId}`
        : null);

  const posterUrl =
    (media as { posterUrl?: string }).posterUrl ||
    (media.posterDriveFileId ? `/api/media/assets/${media.posterDriveFileId}` : null);

  const seasons: SeasonType[] = media.series?.seasons || [];
  const currentSeason = selectedSeasonId
    ? seasons.find((s) => s.id === selectedSeasonId) || seasons[0]
    : seasons[0];

  return (
    <div className="space-y-10">
      {/* Top Hero Banner */}
      <div className="relative w-full rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800/80 shadow-2xl p-6 md:p-10 flex flex-col md:flex-row gap-8 items-end md:items-center min-h-[400px]">
        {/* Backdrop & Gradients */}
        {backdropUrl && (
          <img
            src={backdropUrl}
            alt={media.title}
            className="absolute inset-0 w-full h-full object-cover filter brightness-50"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/50 to-transparent" />

        {/* Poster Image */}
        <div className="relative z-10 w-36 md:w-52 aspect-[2/3] bg-zinc-800 rounded-2xl overflow-hidden shadow-2xl border border-zinc-700/50 flex-shrink-0">
          {posterUrl ? (
            <img src={posterUrl} alt={media.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              {media.type === 'movie' ? <Film className="w-12 h-12" /> : <Tv className="w-12 h-12" />}
            </div>
          )}
        </div>

        {/* Details Text Container */}
        <div className="relative z-10 flex-1">
          <div className="flex items-center gap-3 text-xs text-zinc-300 font-medium mb-2">
            <span className="px-2.5 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 uppercase font-semibold text-zinc-200">
              {media.type === 'movie' ? 'Film' : 'Dizi'}
            </span>
            {media.year && <span>{media.year}</span>}
            {media.duration && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {Math.round(media.duration / 60)} dk
              </span>
            )}
          </div>

          <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight font-display mb-1">
            {media.title}
          </h1>

          {media.originalTitle && (
            <p className="text-sm text-zinc-400 font-medium italic mb-4">{media.originalTitle}</p>
          )}

          {media.overview && (
            <p className="text-sm text-zinc-300 max-w-2xl leading-relaxed mb-6 line-clamp-4">
              {media.overview}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/watch/${media.id}`)}
              className="flex items-center gap-2.5 px-6 py-3.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-brand-500/20 transition-all transform hover:scale-105"
            >
              <Play className="w-5 h-5 fill-current" />
              {media.progress && media.progress.percentage > 0 ? 'Kaldığın Yerden Devam Et' : 'Oynat'}
            </button>

            <button
              onClick={() =>
                toggleFavorite.mutate({
                  mediaItemId: media.id,
                  isFavorite: !!media.isFavorite,
                })
              }
              className={`p-3.5 rounded-xl border backdrop-blur-md transition-all hover:scale-105 ${
                media.isFavorite
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-500'
                  : 'bg-zinc-900/80 border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              <Heart className={`w-5 h-5 ${media.isFavorite ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Series Seasons & Episodes Section */}
      {media.type === 'series' && seasons.length > 0 && (
        <div className="space-y-6 pt-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <h3 className="text-xl font-bold font-display text-white">Sezonlar ve Bölümler</h3>

            {/* Season Selector Tabs */}
            <div className="flex items-center gap-2">
              {seasons.map((season) => (
                <button
                  key={season.id}
                  onClick={() => setSelectedSeasonId(season.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    currentSeason?.id === season.id
                      ? 'bg-brand-600 text-white shadow-md'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  Sezon {season.seasonNumber}
                </button>
              ))}
            </div>
          </div>

          {/* Episode List */}
          <div className="space-y-4">
            {currentSeason?.episodes?.map((episode: EpisodeType) => {
              const epProgress = episode.playbackProgresses?.[0];
              const isWatched = epProgress?.completed;

              return (
                <div
                  key={episode.id}
                  onClick={() => navigate(`/watch/${media.id}/${episode.id}`)}
                  className="group flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/70 hover:border-brand-500/50 rounded-2xl cursor-pointer transition-all gap-4"
                >
                  <div className="flex items-start md:items-center gap-4 flex-1 min-w-0">
                    {/* Episode Thumbnail */}
                    <div className="relative w-36 md:w-44 aspect-video bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-700/40">
                      {episode.stillUrl ? (
                        <img
                          src={episode.stillUrl}
                          alt={episode.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600 bg-zinc-900">
                          <Tv className="w-8 h-8" />
                        </div>
                      )}

                      {/* Play Button Overlay */}
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <div className="p-2.5 bg-brand-600 group-hover:bg-brand-500 text-white rounded-full shadow-lg shadow-brand-500/30 transform scale-95 group-hover:scale-105 transition-transform">
                          <Play className="w-4 h-4 fill-current translate-x-0.5" />
                        </div>
                      </div>
                    </div>

                    {/* Episode Info */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-brand-600/20 border border-brand-500/30 text-brand-400 text-xs font-bold font-display">
                          {episode.seasonNumber}x{episode.episodeNumber < 10 ? `0${episode.episodeNumber}` : episode.episodeNumber}
                        </span>
                        <h4 className="text-base font-bold text-zinc-100 group-hover:text-brand-300 transition-colors truncate">
                          {episode.title}
                        </h4>
                        {isWatched && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>

                      {episode.overview && (
                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed font-normal">
                          {episode.overview}
                        </p>
                      )}

                      {episode.duration && (
                        <div className="flex items-center gap-1 text-[11px] text-zinc-500 font-medium">
                          <Clock className="w-3 h-3" />
                          <span>{Math.round(episode.duration / 60)} dakika</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress Indicator */}
                  {epProgress && epProgress.percentage > 0 && (
                    <div className="w-full md:w-28 flex-shrink-0">
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-500 transition-all"
                          style={{ width: `${Math.min(100, epProgress.percentage)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

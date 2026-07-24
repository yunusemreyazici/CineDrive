import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Heart, Clock, Film, Tv, CheckCircle2, Star, Video, X, User, Pencil, Trash2, AlertTriangle, Loader2, Download } from 'lucide-react';
import { useMediaDetailQuery, useToggleFavoriteMutation, useDeleteMediaItemMutation, useAutoDownloadSubtitleMutation } from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import { EditMetadataModal } from '../components/EditMetadataModal';
import { TrailerModal } from '../components/media/TrailerModal';
import type { SeasonType, EpisodeType } from '../types/media';

export const MediaDetailPage: React.FC = () => {
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const { data: media, isLoading } = useMediaDetailQuery(mediaId);
  const toggleFavorite = useToggleFavoriteMutation();
  const deleteMutation = useDeleteMediaItemMutation();
  const autoSubtitleMutation = useAutoDownloadSubtitleMutation();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [showTrailerModal, setShowTrailerModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);
  const [subMessage, setSubMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAutoDownloadSubtitle = async () => {
    if (!media) return;
    setSubMessage(null);
    try {
      const res = await autoSubtitleMutation.mutateAsync({ mediaId: media.id });
      setSubMessage({ type: 'success', text: res.message || 'Altyazı indirildi!' });
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Altyazı bulunamadı.';
      setSubMessage({ type: 'error', text: msg });
    }
  };

  const handleDeleteItem = async () => {
    if (!media) return;
    try {
      await deleteMutation.mutateAsync(media.id);
      navigate('/library');
    } catch {
      // Error handled by react-query
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowTrailerModal(false);
    };
    if (showTrailerModal) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTrailerModal]);

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
    media.backdropUrl ||
    media.posterUrl ||
    (media.backdropDriveFileId
      ? `/api/media/assets/${media.backdropDriveFileId}`
      : media.posterDriveFileId
        ? `/api/media/assets/${media.posterDriveFileId}`
        : null);

  const posterUrl =
    media.posterUrl ||
    (media.posterDriveFileId ? `/api/media/assets/${media.posterDriveFileId}` : null);

  const seasons: SeasonType[] = media.series?.seasons || [];
  const currentSeason = selectedSeasonId
    ? seasons.find((s) => s.id === selectedSeasonId) || seasons[0]
    : seasons[0];

  // YouTube Embed Link Extractor
  const getYouTubeEmbedUrl = (url?: string) => {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1` : null;
  };
  const embedTrailerUrl = getYouTubeEmbedUrl(media.trailerUrl);

  return (
    <div className="space-y-10">
      {/* Top Hero Banner */}
      <div className="relative w-full rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800/80 shadow-2xl p-6 md:p-10 flex flex-col md:flex-row gap-8 items-end md:items-center min-h-[420px]">
        {/* Backdrop & Gradients */}
        {backdropUrl && (
          <img
            src={backdropUrl}
            alt={media.title}
            className="absolute inset-0 w-full h-full object-cover filter brightness-[0.4]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/60 to-transparent" />

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
          {/* Metadata Badges (Type, Year, Duration, Rating, Content Rating) */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-zinc-300 font-medium mb-3">
            <span className="px-2.5 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 uppercase font-semibold text-zinc-200">
              {media.type === 'movie' ? 'Film' : 'Dizi'}
            </span>

            {media.voteAverage && (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 font-bold">
                <Star className="w-3.5 h-3.5 fill-current text-amber-400" />
                {media.voteAverage.toFixed(1)} / 10
              </span>
            )}

            {media.contentRating && (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold">
                {media.contentRating}
              </span>
            )}

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
            <p className="text-sm text-zinc-400 font-medium italic mb-3">{media.originalTitle}</p>
          )}

          {/* Genre Badges */}
          {media.genres && media.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {media.genres.map((genre) => (
                <span
                  key={genre}
                  className="px-2 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-700/60 text-[11px] font-medium text-zinc-300"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          {media.overview && (
            <p className="text-sm text-zinc-300 max-w-2xl leading-relaxed mb-6 line-clamp-4">
              {media.overview}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate(`/watch/${media.id}`)}
              className="flex items-center gap-2.5 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-brand-500/20 transition-all transform hover:scale-105"
            >
              <Play className="w-5 h-5 fill-current" />
              {media.progress && media.progress.percentage > 0 ? 'Kaldığın Yerden Devam Et' : 'Oynat'}
            </button>

            {embedTrailerUrl && (
              <button
                onClick={() => setShowTrailerModal(true)}
                className="flex items-center gap-2 px-5 py-3 bg-zinc-800/90 hover:bg-zinc-700 text-white font-medium text-sm rounded-xl border border-zinc-700 backdrop-blur-md transition-all hover:scale-105"
              >
                <Video className="w-4 h-4 text-brand-400" />
                Fragman İzle
              </button>
            )}

            {/* Series subtitles must be selected for a concrete episode in the player. */}
            {media.type === 'movie' && <button
              onClick={handleAutoDownloadSubtitle}
              disabled={autoSubtitleMutation.isPending}
              className="flex items-center gap-2 px-4 py-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-medium text-sm rounded-xl border border-indigo-500/30 backdrop-blur-md transition-all hover:scale-105 disabled:opacity-50"
              title="OpenSubtitles üzerinden Türkçe altyazı indir ve veritabanına kaydet"
            >
              {autoSubtitleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Altyazı İndiriliyor...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-indigo-400" />
                  <span>Altyazı İndir</span>
                </>
              )}
            </button>}

            <button
              onClick={() =>
                toggleFavorite.mutate({
                  mediaItemId: media.id,
                  isFavorite: !!media.isFavorite,
                })
              }
              className={`p-3 rounded-xl border backdrop-blur-md transition-all hover:scale-105 ${
                media.isFavorite
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                  : 'bg-zinc-800/90 border-zinc-700 text-zinc-300 hover:text-white'
              }`}
              title={media.isFavorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
            >
              <Heart className={`w-5 h-5 ${media.isFavorite ? 'fill-current' : ''}`} />
            </button>

            {/* Edit Metadata Button */}
            <button
              onClick={() => setShowEditModal(true)}
              className="flex items-center gap-2 px-4 py-3 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 font-medium text-sm rounded-xl border border-zinc-700 backdrop-blur-md transition-all hover:scale-105"
              title="Metadata Düzenle"
            >
              <Pencil className="w-4 h-4 text-brand-400" />
              Düzenle
            </button>

            {/* Delete Item Button */}
            <button
              onClick={() => setShowDeleteConfirmModal(true)}
              className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium text-sm rounded-xl border border-rose-500/30 backdrop-blur-md transition-all hover:scale-105"
              title="Veritabanından Sil"
            >
              <Trash2 className="w-4 h-4" />
              Sil
            </button>
          </div>

          {subMessage && (
            <div
              className={`mt-4 p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 animate-in fade-in ${
                subMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              {subMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              )}
              <span>{subMessage.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Cast Members Section ("Oyuncu Kadrosu") */}
      {media.cast && media.cast.length > 0 && (
        <div className="space-y-4 pt-2">
          <h3 className="text-xl font-bold font-display text-white border-b border-zinc-800 pb-3">
            Oyuncu Kadrosu
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {media.cast.map((actor, idx) => (
              <div
                key={idx}
                onClick={() => navigate(`/person/${encodeURIComponent(actor.name)}`)}
                className="flex items-center gap-3 p-2.5 bg-zinc-900/60 border border-zinc-800/70 rounded-2xl hover:border-brand-500/50 hover:bg-brand-600/10 cursor-pointer transition-all group"
                title={`${actor.name} içeriklerini gör`}
              >
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex-shrink-0 overflow-hidden border border-zinc-700/50 flex items-center justify-center text-zinc-500 group-hover:border-brand-500/50">
                  {actor.profileUrl ? (
                    <img src={actor.profileUrl} alt={actor.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-6 h-6 text-zinc-400 group-hover:text-brand-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-zinc-100 truncate group-hover:text-brand-400 transition-colors">
                    {actor.name}
                  </p>
                  {actor.character && (
                    <p className="text-[11px] text-zinc-400 truncate">{actor.character}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Trailer YouTube Embed Modal */}
      {showTrailerModal && embedTrailerUrl && (
        <div
          onClick={() => setShowTrailerModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Video className="w-4 h-4 text-brand-400" />
                {media.title} — Resmi Fragman
              </h3>
              <button
                onClick={() => setShowTrailerModal(false)}
                className="p-1.5 text-zinc-400 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative w-full aspect-video bg-black">
              <iframe
                src={embedTrailerUrl}
                title={`${media.title} Fragman`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Metadata Modal */}
      {showEditModal && (
        <EditMetadataModal
          media={media}
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-500/20 text-rose-400 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-display">İçeriği Sil</h3>
                <p className="text-xs text-zinc-400">Bu işlem CineDrive veritabanından kaldırılacaktır.</p>
              </div>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed">
              <strong className="text-white">{media.title}</strong> içerikli medya kaydı veritabanından silinecektir. Google Drive dosyanız silinmez. Devam etmek istiyor musunuz?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmModal(false)}
                className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleDeleteItem}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Siliniyor...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Evet, Sil
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trailer Modal */}
      <TrailerModal
        isOpen={showTrailerModal}
        onClose={() => setShowTrailerModal(false)}
        title={media.title}
        trailerUrl={media.trailerUrl}
      />
    </div>
  );
};

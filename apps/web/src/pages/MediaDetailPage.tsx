import React, { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Play, Heart, Clock, Film, Tv, CheckCircle2, Star, Video, User, Pencil, Trash2, AlertTriangle, Loader2, Download } from 'lucide-react';
import { useMediaDetailQuery, useToggleFavoriteMutation, useDeleteMediaItemMutation, useAutoDownloadSubtitleMutation, useMediaListQuery } from '../hooks/useApi';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Modal } from '../components/common/Modal';
import { toast } from '../stores/useToastStore';
import { MediaCard } from '../components/media/MediaCard';
import { EditMetadataModal } from '../components/EditMetadataModal';
import { TrailerModal } from '../components/media/TrailerModal';
import { extractYoutubeId } from '../utils/youtube';
import type { SeasonType, EpisodeType } from '../types/media';
import { getHeroArtworkUrl, getPosterUrl } from '../utils/mediaImages';
import { t } from '../i18n';

/** Everything that is not "play this" shares one quiet treatment. */
const SECONDARY_ACTION_CLASSES =
  'flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:opacity-50';

/** Record housekeeping: available, but not competing with playback. */
const MANAGEMENT_ACTION_CLASSES =
  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

export const MediaDetailPage: React.FC = () => {
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const { data: media, isLoading, isError, error, refetch } = useMediaDetailQuery(mediaId);
  const primaryGenre = media?.genres?.[0];
  const { data: similarData } = useMediaListQuery(
    media
      ? {
          type: media.type,
          genre: primaryGenre,
          sortBy: 'voteAverage',
          sortOrder: 'desc',
          limit: 12,
        }
      : undefined,
    { enabled: !!media },
  );
  const toggleFavorite = useToggleFavoriteMutation();
  const deleteMutation = useDeleteMediaItemMutation();
  const autoSubtitleMutation = useAutoDownloadSubtitleMutation();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [showTrailerModal, setShowTrailerModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);
  const [isOverviewExpanded, setIsOverviewExpanded] = useState<boolean>(false);

  const handleAutoDownloadSubtitle = async () => {
    if (!media) return;
    try {
      const res = await autoSubtitleMutation.mutateAsync({ mediaId: media.id });
      toast.success(res.message || t.mediaDetail.subtitleDownloaded);
    } catch (err: unknown) {
      toast.fromError(err, t.mediaDetail.subtitleNotFound);
    }
  };

  const handleDeleteItem = async () => {
    if (!media) return;
    try {
      await deleteMutation.mutateAsync(media.id);
      toast.success(t.mediaDetail.removed(media.title));
      navigate('/library');
    } catch (err: unknown) {
      toast.fromError(err, t.mediaDetail.deleteFailed);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="w-full h-80 bg-zinc-900 rounded-3xl" />
        <div className="h-8 bg-zinc-900 rounded-xl w-1/3" />
        <div className="h-20 bg-zinc-900 rounded-xl w-2/3" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        error={error}
        title={t.errors.contentLoadFailed}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!media) {
    return (
      <EmptyState
        title={t.mediaDetail.notFoundTitle}
        description={t.mediaDetail.notFoundDescription}
        actionLabel={t.mediaDetail.backToLibrary}
        onAction={() => navigate('/library')}
      />
    );
  }

  const backdropUrl = getHeroArtworkUrl(media);
  const posterUrl = getPosterUrl(media);

  const seasons: SeasonType[] = media.series?.seasons || [];
  const currentSeason = selectedSeasonId
    ? seasons.find((s) => s.id === selectedSeasonId) || seasons[0]
    : seasons[0];

  const hasTrailer = Boolean(extractYoutubeId(media.trailerUrl));
  const similarItems = (similarData?.media || [])
    .filter((item) => item.id !== media.id)
    .slice(0, 6);

  return (
    <div className="space-y-10">
      {/* Top Hero Banner */}
      <div className="relative w-full rounded-3xl overflow-hidden bg-zinc-900 border border-zinc-800/80 shadow-2xl p-6 md:p-10 flex flex-col md:flex-row gap-8 items-end md:items-center min-h-[420px]">
        {/* Backdrop & Gradients */}
        {backdropUrl && (
          <img
            src={backdropUrl}
            alt={media.title}
            // The LCP element of this page; see FeaturedHero for the same hint.
            fetchPriority="high"
            decoding="async"
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
          {/*
            One line of facts, one treatment. These were three different badge
            styles for the same kind of information, and the content rating was
            filled rose — the colour this app uses for destructive actions.
          */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] font-medium text-zinc-400">
            <span className="uppercase tracking-wide text-zinc-300">
              {media.type === 'movie' ? t.common.movie : t.common.series}
            </span>

            {media.voteAverage ? (
              <span className="flex items-center gap-1 text-zinc-300">
                <Star className="h-3.5 w-3.5 fill-current text-amber-400" />
                {media.voteAverage.toFixed(1)}
              </span>
            ) : null}

            {media.contentRating && (
              <span className="rounded border border-zinc-600 px-1.5 text-xs text-zinc-300">
                {media.contentRating}
              </span>
            )}

            {media.year && <span>{media.year}</span>}

            {media.duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {t.common.minutes(Math.round(media.duration / 60))}
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
            <div className="mb-6 max-w-2xl">
              <p
                className={`text-sm leading-relaxed text-zinc-300 ${
                  isOverviewExpanded ? '' : 'line-clamp-4'
                }`}
              >
                {media.overview}
              </p>
              {/* The summary was clamped with no way to reach the rest of it. */}
              <button
                type="button"
                onClick={() => setIsOverviewExpanded((expanded) => !expanded)}
                aria-expanded={isOverviewExpanded}
                className="mt-1 text-[13px] font-medium text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {isOverviewExpanded ? t.mediaDetail.showLess : t.mediaDetail.showMore}
              </button>
            </div>
          )}

          {/*
            Two groups, not one row of six equals. Playing the thing is the
            reason for this page; editing and deleting the record are
            housekeeping, and delete used to sit one tab stop from play at the
            same size and saturation.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate(`/watch/${media.id}`)}
              className="flex items-center gap-2.5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <Play className="h-5 w-5 fill-current" />
              {media.progress && media.progress.percentage > 0
                ? t.mediaDetail.resume
                : t.mediaDetail.play}
            </button>

            {hasTrailer && (
              <button
                onClick={() => setShowTrailerModal(true)}
                className={SECONDARY_ACTION_CLASSES}
              >
                <Video className="h-4 w-4" />
                {t.mediaDetail.watchTrailer}
              </button>
            )}

            <button
              onClick={() =>
                toggleFavorite.mutate({
                  mediaItemId: media.id,
                  isFavorite: !!media.isFavorite,
                })
              }
              aria-pressed={!!media.isFavorite}
              className={`${SECONDARY_ACTION_CLASSES} ${
                media.isFavorite ? 'text-rose-400' : ''
              }`}
              title={media.isFavorite ? t.mediaDetail.favoriteRemove : t.mediaDetail.favoriteAdd}
              aria-label={media.isFavorite ? t.mediaDetail.favoriteRemove : t.mediaDetail.favoriteAdd}
            >
              <Heart className={`h-4 w-4 ${media.isFavorite ? 'fill-current' : ''}`} />
            </button>

            {/* Series subtitles must be selected for a concrete episode in the player. */}
            {media.type === 'movie' && (
              <button
                onClick={handleAutoDownloadSubtitle}
                disabled={autoSubtitleMutation.isPending}
                className={SECONDARY_ACTION_CLASSES}
                title={t.mediaDetail.downloadSubtitleTitle}
              >
                {autoSubtitleMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {autoSubtitleMutation.isPending
                  ? t.mediaDetail.downloadingSubtitle
                  : t.mediaDetail.downloadSubtitle}
              </button>
            )}

            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

            <button
              onClick={() => setShowEditModal(true)}
              className={MANAGEMENT_ACTION_CLASSES}
              title={t.mediaDetail.editTitle}
            >
              <Pencil className="h-4 w-4" />
              {t.mediaDetail.edit}
            </button>

            <button
              onClick={() => setShowDeleteConfirmModal(true)}
              className={`${MANAGEMENT_ACTION_CLASSES} hover:bg-rose-500/10 hover:text-rose-400`}
              title={t.mediaDetail.deleteFromDatabase}
            >
              <Trash2 className="h-4 w-4" />
              {t.common.delete}
            </button>
          </div>

        </div>
      </div>

      {/* Cast Members Section ("Oyuncu Kadrosu") */}
      {media.cast && media.cast.length > 0 && (
        <div className="space-y-4 pt-2">
          <h3 className="text-xl font-bold font-display text-white border-b border-zinc-800 pb-3">
            {t.mediaDetail.cast}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {media.cast.map((actor) => (
              <Link
                key={`${actor.name}-${actor.character || ''}`}
                to={`/person/${encodeURIComponent(actor.name)}`}
                className="group flex items-center gap-3 rounded-2xl border border-zinc-800/70 bg-zinc-900/60 p-2.5 transition-all hover:border-brand-500/50 hover:bg-brand-600/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                title={t.mediaDetail.castLink(actor.name)}
              >
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex-shrink-0 overflow-hidden border border-zinc-700/50 flex items-center justify-center text-zinc-500 group-hover:border-brand-500/50">
                  {actor.profileUrl ? (
                    <img
                      src={actor.profileUrl}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
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
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Series Seasons & Episodes Section */}
      {media.type === 'series' && seasons.length > 0 && (
        <div className="space-y-6 pt-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <h3 className="text-xl font-bold font-display text-white">{t.mediaDetail.seasonsAndEpisodes}</h3>

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
                  {t.mediaDetail.season(season.seasonNumber)}
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
                <Link
                  key={episode.id}
                  to={`/watch/${media.id}/${episode.id}`}
                  className="group flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/70 hover:border-brand-500/50 rounded-2xl transition-all gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <div className="flex items-start md:items-center gap-4 flex-1 min-w-0">
                    {/* Episode Thumbnail */}
                    <div className="relative w-36 md:w-44 aspect-video bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-700/40">
                      {episode.stillUrl ? (
                        <img
                          src={episode.stillUrl}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600 bg-zinc-900">
                          <Tv className="w-8 h-8" />
                        </div>
                      )}

                      {/* Play Button Overlay */}
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center"
                      >
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
                          <span>{t.common.minutesLong(Math.round(episode.duration / 60))}</span>
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
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {similarItems.length > 0 && (
        <section className="space-y-4" aria-labelledby="similar-media-heading">
          <div>
            <h2
              id="similar-media-heading"
              className="text-2xl font-extrabold font-display text-white"
            >
              {t.mediaDetail.similar}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {primaryGenre
                ? t.mediaDetail.similarByGenre(primaryGenre)
                : t.mediaDetail.similarGeneric}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {similarItems.map((item) => (
              <MediaCard key={item.id} media={item} />
            ))}
          </div>
        </section>
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
      <Modal
        isOpen={showDeleteConfirmModal}
        onClose={() => setShowDeleteConfirmModal(false)}
        size="sm"
        title={t.mediaDetail.deleteTitle}
        description={t.mediaDetail.deleteDescription}
        icon={
          <div className="rounded-2xl bg-rose-500/20 p-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteConfirmModal(false)}
              className="rounded-xl bg-zinc-800 px-5 py-2.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-700"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleDeleteItem}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition-all hover:bg-rose-500 disabled:opacity-50"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.mediaDetail.deleting}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {t.mediaDetail.deleteYes}
                </>
              )}
            </button>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-zinc-300">
          <strong className="text-white">{media.title}</strong>{' '}
          {t.mediaDetail.deleteConfirmPrefix} {t.mediaDetail.deleteConfirm}
        </p>
      </Modal>

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

import { useMemo } from 'react';
import type {
  EpisodeType,
  MediaItemType,
  PlaybackPlanType,
  PlaybackProgressType,
} from '../../../types/media';
import type { SubtitleItemType } from '../../../types/media';

export interface ActiveMedia {
  driveFileId: string | null;
  title: string;
  episodes: EpisodeType[];
  episodeIndex: number;
  previousEpisode: EpisodeType | null;
  nextEpisode: EpisodeType | null;
  activeEpisodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  playbackPlan?: PlaybackPlanType;
  analyzedDuration?: number;
  analyzedHeight?: number;
  progress: PlaybackProgressType | null;
  subtitles: SubtitleItemType[];
}

const formatEpisodeTitle = (mediaTitle: string, episode: EpisodeType) => {
  const paddedEpisode =
    episode.episodeNumber < 10 ? `0${episode.episodeNumber}` : `${episode.episodeNumber}`;
  return `${mediaTitle} - ${episode.seasonNumber}x${paddedEpisode} ${episode.title}`;
};

/**
 * Resolves "what exactly is playing" — the Drive file, its analysis results,
 * its subtitles and its neighbours — from the media item plus the requested
 * episode. Previously this was ~40 lines of `let` reassignment in the middle of
 * the component body, re-run on every render.
 */
export const useActiveMedia = (media: MediaItemType, episodeId?: string): ActiveMedia =>
  useMemo(() => {
    const base: ActiveMedia = {
      driveFileId: null,
      title: media.title,
      episodes: [],
      episodeIndex: -1,
      previousEpisode: null,
      nextEpisode: null,
      activeEpisodeId: episodeId,
      progress: media.progress || null,
      subtitles: media.subtitles || [],
    };

    if (media.type === 'movie' && media.movie) {
      return {
        ...base,
        driveFileId: media.movie.driveFileId,
        playbackPlan: media.movie.playbackPlan,
        analyzedDuration: media.movie.technicalMetadata?.mediaDuration,
        analyzedHeight: media.movie.technicalMetadata?.mediaHeight,
      };
    }

    if (media.type !== 'series' || !media.series) return base;

    const episodes = media.series.seasons.flatMap((season) => season.episodes);
    const requestedIndex = episodeId ? episodes.findIndex((e) => e.id === episodeId) : 0;
    const episodeIndex = requestedIndex < 0 ? 0 : requestedIndex;
    const episode = episodes[episodeIndex];

    if (!episode) return { ...base, episodes };

    return {
      ...base,
      episodes,
      episodeIndex,
      previousEpisode: episodeIndex > 0 ? episodes[episodeIndex - 1]! : null,
      nextEpisode: episodeIndex < episodes.length - 1 ? episodes[episodeIndex + 1]! : null,
      activeEpisodeId: episode.id,
      driveFileId: episode.driveFileId,
      title: formatEpisodeTitle(media.title, episode),
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      playbackPlan: episode.playbackPlan,
      analyzedDuration: episode.technicalMetadata?.mediaDuration,
      analyzedHeight: episode.technicalMetadata?.mediaHeight,
      progress: episode.playbackProgresses?.[0] || media.progress || null,
      subtitles: episode.subtitles || media.subtitles || [],
    };
  }, [episodeId, media]);

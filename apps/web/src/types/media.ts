export interface SubtitleItemType {
  id: string;
  languageCode: string;
  languageLabel: string;
  forced: boolean;
  hearingImpaired: boolean;
  isDefault: boolean;
  url: string;
}

export interface EpisodeType {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  duration?: number;
  overview?: string;
  stillUrl?: string;
  driveFileId: string;
  subtitles?: SubtitleItemType[];
  playbackProgresses?: PlaybackProgressType[];
}

export interface SeasonType {
  id: string;
  seasonNumber: number;
  name?: string;
  episodes: EpisodeType[];
}

export interface SeriesType {
  id: string;
  seasons: SeasonType[];
}

export interface MovieType {
  id: string;
  driveFileId: string;
}

export interface PlaybackProgressType {
  positionSeconds: number;
  durationSeconds: number;
  percentage: number;
  completed: boolean;
}

export interface MediaItemType {
  id: string;
  type: 'movie' | 'series';
  title: string;
  originalTitle?: string;
  normalizedTitle: string;
  year?: number;
  overview?: string;
  posterDriveFileId?: string;
  backdropDriveFileId?: string;
  duration?: number;
  isFavorite?: boolean;
  movie?: MovieType;
  series?: SeriesType;
  progress?: PlaybackProgressType | null;
  subtitles?: SubtitleItemType[];
}

export interface WatchHistoryType {
  id: string;
  watchedAt: string;
  mediaItem: MediaItemType;
}

export interface LibraryScanType {
  id: string;
  status: 'running' | 'completed' | 'failed';
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  errorCount: number;
  durationMs?: number;
  startedAt: string;
  completedAt?: string;
}

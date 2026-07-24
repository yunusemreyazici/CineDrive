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
  progress?: {
    positionSeconds: number;
    durationSeconds: number;
    percentage: number;
    completed: boolean;
  } | null;
  movie?: {
    driveFileId: string;
  };
  series?: {
    seasons: SeasonType[];
  };
}

export interface SeasonType {
  id: string;
  seriesId: string;
  seasonNumber: number;
  name?: string;
  episodes: EpisodeType[];
}

export interface EpisodeType {
  id: string;
  seriesId: string;
  seasonId: string;
  driveFileId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  duration?: number;
  playbackProgresses?: {
    positionSeconds: number;
    durationSeconds: number;
    percentage: number;
    completed: boolean;
  }[];
}

export interface WatchHistoryType {
  id: string;
  userId: string;
  mediaItemId: string;
  watchedAt: string;
  mediaItem: MediaItemType;
}

export interface LibraryScanType {
  id: string;
  libraryId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  addedCount: number;
  updatedCount: number;
  errorCount: number;
}

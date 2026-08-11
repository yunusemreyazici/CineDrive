export interface SubtitleItemType {
  id: string;
  languageCode: string;
  languageLabel: string;
  forced: boolean;
  hearingImpaired: boolean;
  isDefault: boolean;
  url: string;
}

export type PlaybackMode = 'direct' | 'audio' | 'hls' | 'full';

export interface PlaybackPlanType {
  safari: PlaybackMode;
  chromium: PlaybackMode;
  reason: string;
  analyzed: boolean;
}

export interface MediaTechnicalMetadataType {
  mediaContainer?: string;
  videoCodec?: string;
  videoProfile?: string;
  videoBitDepth?: number;
  audioCodec?: string;
  audioChannels?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaDuration?: number;
  mediaAnalyzedAt?: string;
  mediaAnalysisError?: string;
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
  playbackPlan?: PlaybackPlanType;
  technicalMetadata?: MediaTechnicalMetadataType;
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
  playbackPlan?: PlaybackPlanType;
  technicalMetadata?: MediaTechnicalMetadataType;
}

export interface PlaybackProgressType {
  positionSeconds: number;
  durationSeconds: number;
  percentage: number;
  completed: boolean;
}

export interface CastMemberType {
  name: string;
  character?: string;
  profileUrl?: string;
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
  posterUrl?: string;
  backdropUrl?: string;
  duration?: number;
  voteAverage?: number;
  voteCount?: number;
  genres?: string[];
  cast?: CastMemberType[];
  trailerUrl?: string;
  contentRating?: string;
  tmdbId?: number;
  imdbId?: string;
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
  episodeId?: string;
  episode?: EpisodeType;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  deviceType?: 'desktop' | 'tablet' | 'mobile' | 'unknown';
}

export interface LibraryScanType {
  id: string;
  libraryId?: string;
  driveScanSourceId?: string | null;
  sourceType?: 'drive' | 'local' | 'all';
  sourceName?: string;
  sourceLocation?: string | null;
  status: 'running' | 'completed' | 'failed';
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  errorCount: number;
  durationMs?: number | null;
  startedAt: string;
  completedAt?: string | null;
  lastError?: string | null;
  errors?: Array<{
    id: string;
    driveFileId?: string | null;
    errorMessage: string;
    createdAt: string;
  }>;
}

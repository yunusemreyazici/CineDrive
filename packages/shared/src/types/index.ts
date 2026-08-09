export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface GoogleConnectionDto {
  id: string;
  email: string;
  googleAccountId: string;
  scopes: string[];
  createdAt: string;
}

export interface CastMemberDto {
  name: string;
  character?: string;
  profileUrl?: string;
}

export interface MediaItemDto {
  id: string;
  type: 'movie' | 'series';
  title: string;
  originalTitle?: string;
  normalizedTitle: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  duration?: number;
  voteAverage?: number;
  voteCount?: number;
  genres?: string[];
  cast?: CastMemberDto[];
  trailerUrl?: string;
  contentRating?: string;
  tmdbId?: number;
  imdbId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedDriveDto {
  id: string;
  name: string;
}

export interface DuplicateFileDto {
  id: string;
  name: string;
  size: number;
  libraryName: string;
  googleDriveFileId: string;
  reason: string;
}

export interface StorageInsightsDto {
  totalFiles: number;
  totalSizeBytes: number;
  averageSizeBytes: number;
  resolutions: {
    k4: { count: number; sizeBytes: number };
    p1080: { count: number; sizeBytes: number };
    p720: { count: number; sizeBytes: number };
    sd: { count: number; sizeBytes: number };
  };
  duplicates: DuplicateFileDto[];
  largestFiles: Array<{
    id: string;
    name: string;
    size: number;
    libraryName: string;
    googleDriveFileId: string;
  }>;
}

export interface MediaHealthDto {
  totalVideos: number;
  analyzedVideos: number;
  failedVideos: number;
  pendingVideos: number;
  playback: {
    safari: Record<'direct' | 'audio' | 'hls' | 'full', number>;
    chromium: Record<'direct' | 'audio' | 'hls' | 'full', number>;
  };
  codecs: {
    video: Array<{ name: string; count: number }>;
    audio: Array<{ name: string; count: number }>;
    containers: Array<{ name: string; count: number }>;
  };
  runtime: {
    hls: {
      activeJobs: number;
      queuedJobs: number;
      cacheBytes: number;
      cacheEntries: number;
      maxCacheBytes: number;
      maxActiveJobs: number;
      jobs: Array<{
        id: string;
        cacheKey: string;
        mediaName: string;
        pid: number | null;
        startSeconds: number;
        startedAt: string;
        lastAccessAt: string;
        viewerCount: number;
        profile: 'video-copy-aac' | 'h264-aac';
        bufferLeadSeconds: number;
        isPaused: boolean;
      }>;
      queue: Array<{
        id: string;
        mediaName: string;
        startSeconds: number;
        priority: 'seek' | 'normal';
        queuedAt: string;
        waitMs: number;
      }>;
    };
    transcode: {
      activeSessions: number;
      maxActiveSessions: number;
    };
    playerTelemetry: {
      sampleCount: number;
      firstFrameAverageMs: number;
      stallCount: number;
      stallAverageMs: number;
      seekCount: number;
      seekRecoveryAverageMs: number;
      errorCount: number;
      recent: Array<{
        mediaId: string;
        driveFileId: string;
        browser: 'safari' | 'chromium' | 'other';
        playbackMode: 'direct' | 'audio' | 'hls' | 'full';
        event: 'first-frame' | 'stall' | 'seek-recovery' | 'error';
        durationMs?: number;
        occurredAt: number;
      }>;
    };
  };
  failures: Array<{
    id: string;
    name: string;
    libraryName: string;
    error: string;
  }>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

export interface LibraryDto {
  id: string;
  name: string;
  storageType: 'gdrive' | 'local';
  rootFolderId?: string;
  localFolderPath?: string;
  googleConnectionId?: string | null;
  driveId?: string | null;
  lastScannedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MusicArtworkDto {
  id: string;
  url: string;
}

export interface MusicArtistDto {
  id: string;
  name: string;
  sortName?: string | null;
  musicbrainzId?: string | null;
  albumCount?: number;
  trackCount?: number;
  artworkUrl?: string | null;
}

export interface MusicAlbumDto {
  id: string;
  title: string;
  year?: number | null;
  genres: string[];
  artist?: MusicArtistDto | null;
  artworkUrl?: string | null;
  trackCount?: number;
  releaseType?: string;
  secondaryTypes?: string[];
  musicbrainzReleaseId?: string | null;
  musicbrainzReleaseGroupId?: string | null;
}

export interface MusicTrackCreditDto {
  id: string;
  name: string;
  role: string;
  instrument?: string | null;
  musicbrainzId?: string | null;
  source: 'tag' | 'musicbrainz' | 'manual' | string;
}

export interface MusicTrackDto {
  id: string;
  title: string;
  discNumber: number;
  trackNumber: number;
  year?: number | null;
  genres: string[];
  duration?: number | null;
  album?: MusicAlbumDto | null;
  primaryArtist?: MusicArtistDto | null;
  artists: MusicArtistDto[];
  artworkUrl?: string | null;
  isFavorite: boolean;
  playCount?: number;
  metadataLocked?: boolean;
  musicbrainzRecordingId?: string | null;
  credits?: MusicTrackCreditDto[];
  audio?: {
    container?: string | null;
    codec?: string | null;
    channels?: number | null;
    sampleRate?: number | null;
    bitrate?: number | null;
    bitDepth?: number | null;
    lossless?: boolean | null;
    replayGainTrackDb?: number | null;
    replayGainTrackPeak?: number | null;
    replayGainAlbumDb?: number | null;
    replayGainAlbumPeak?: number | null;
  };
  source?: {
    fileName: string;
    mimeType: string;
    sizeBytes?: string | null;
    modifiedAt?: string | null;
    storageType: string;
    localPath?: string | null;
    googleDriveFileId?: string | null;
    library: { id: string; name: string; storageType: string };
  };
  streamUrl: string;
  createdAt: string;
}

export interface MusicPlaylistDto {
  id: string;
  name: string;
  description?: string | null;
  itemCount: number;
  duration: number;
  updatedAt: string;
  items?: Array<{ id: string; position: number; track: MusicTrackDto }>;
}

export interface MusicPlaybackStateDto {
  revision: number;
  currentTrackId: string | null;
  currentQueueItemId: string | null;
  positionSeconds: number;
  shuffleEnabled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  queue: Array<{
    id: string;
    trackId: string;
    sourceOrder: number;
    playOrder: number;
    track: MusicTrackDto;
  }>;
}

export interface MusicLyricsLineDto {
  timeMs: number | null;
  text: string;
}

export interface MusicLyricsDto {
  trackId: string;
  sourceName: string;
  language?: string | null;
  isSynced: boolean;
  offsetMs: number;
  lines: MusicLyricsLineDto[];
  updatedAt: string;
}

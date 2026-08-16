export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;
  disabled: boolean;
}

export interface LibraryMemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'editor' | 'listener';
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
  fileCount?: number;
  lastScan?: SourceScanSummaryDto | null;
  createdAt: string;
  updatedAt: string;
  accessRole?: 'owner' | 'editor' | 'listener';
}

export interface SourceScanSummaryDto {
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  heartbeatAt?: string | null;
  completedAt?: string | null;
  interruptionReason?: 'server_restarted' | 'server_shutdown' | 'watchdog_timeout' | null;
  durationMs?: number | null;
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  errorCount: number;
  lastError?: string | null;
}

export interface DriveScanSourceDto {
  id: string;
  libraryId: string;
  googleConnectionId: string;
  googleAccountEmail: string;
  rootFolderId: string;
  folderName?: string | null;
  folderPath?: string | null;
  driveName?: string | null;
  ownerName?: string | null;
  webViewLink?: string | null;
  fileCount: number;
  lastScan?: SourceScanSummaryDto | null;
  createdAt: string;
}

export interface DriveSourceValidationDto {
  folderName: string;
  folderPath: string;
  driveName?: string | null;
  ownerName?: string | null;
  webViewLink?: string | null;
  hasMediaFiles: boolean;
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
  artworkSource?: string | null;
  artworkAttribution?: string | null;
  artworkLicense?: string | null;
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
  trackIds?: string[];
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

export interface MusicMixDto {
  id: string;
  type:
    | 'daily'
    | 'recent'
    | 'artist-radio'
    | 'mood'
    | 'genre'
    | 'decade'
    | 'rediscovery'
    | 'favorites'
    | 'collection';
  title: string;
  subtitle: string;
  description?: string;
  accent: string;
  artworkUrls: string[];
  tracks: MusicTrackDto[];
}

export interface MusicDiscoveryDto {
  mixes: MusicMixDto[];
  moodCollections: MusicMixDto[];
  genreCollections: MusicMixDto[];
  decadeCollections: MusicMixDto[];
  continueListening?: { track: MusicTrackDto; positionSeconds: number } | null;
  unfinishedAlbums: Array<MusicAlbumDto & { progress: number; tracks: MusicTrackDto[] }>;
  radioArtists: MusicArtistDto[];
}

export interface MusicDuplicateGroupDto {
  key: string;
  tracks: MusicTrackDto[];
  recommendedTrackId?: string;
  quality?: Array<{ trackId: string; score: number; label: string }>;
}

export interface MusicFingerprintStatusDto {
  available: boolean;
  acoustidConfigured: boolean;
  total: number;
  analyzed: number;
  identified: number;
  failed: number;
}

export interface MusicMaintenanceSuggestionDto {
  id: string;
  targetType: string;
  targetId: string;
  kind: string;
  provider: string;
  confidence: number;
  currentData: unknown;
  proposedData: unknown;
  target?: {
    title: string;
    subtitle?: string | null;
    artworkUrl?: string | null;
  };
  status: string;
  createdAt: string;
}

export interface MusicMaintenanceActionDto {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  revertedAt?: string | null;
}

export interface MusicMaintenanceDto {
  artists: Array<
    MusicArtistDto & {
      artworkSource?: string | null;
      artworkAttribution?: string | null;
      artworkLicense?: string | null;
      artworkLookupStatus?: 'pending' | 'found' | 'not-found' | 'failed' | 'manual-skip';
      artworkLookupAt?: string | null;
    }
  >;
  missingArtwork: MusicTrackDto[];
  missingMetadata: Array<MusicTrackDto & { confidence: number; issues: string[] }>;
  duplicates: MusicDuplicateGroupDto[];
  acousticDuplicates: MusicDuplicateGroupDto[];
  replayGainMissing: MusicTrackDto[];
  fingerprintCandidates: MusicTrackDto[];
  fingerprints: MusicFingerprintStatusDto;
  suggestions?: MusicMaintenanceSuggestionDto[];
  actions?: MusicMaintenanceActionDto[];
  totals: {
    missingArtistArtwork: number;
    missingArtwork: number;
    missingMetadata: number;
    duplicates: number;
    acousticDuplicates: number;
    replayGainMissing: number;
  };
}

export interface MusicLyricsLineDto {
  timeMs: number | null;
  text: string;
  words?: Array<{ timeMs: number; text: string }>;
}

export interface MusicLyricsTranslationDto {
  id: string;
  language: string;
  provider: string;
  isMachine: boolean;
  content: string;
  lines: MusicLyricsLineDto[];
}

export interface MusicLyricsDto {
  trackId: string;
  sourceName: string;
  language?: string | null;
  isSynced: boolean;
  offsetMs: number;
  lines: MusicLyricsLineDto[];
  content?: string;
  translatedContent?: string | null;
  romanizedContent?: string | null;
  translatedLines?: MusicLyricsLineDto[];
  romanizedLines?: MusicLyricsLineDto[];
  translationLanguage?: string | null;
  translations?: MusicLyricsTranslationDto[];
  revisions?: Array<{
    id: string;
    sourceName: string;
    content: string;
    status: string;
    createdAt: string;
  }>;
  updatedAt: string;
}

export interface MusicReplayDto {
  period: 'day' | 'week' | 'month' | 'year';
  year: number | null;
  range: { start: string; end: string };
  totalSeconds: number;
  totalPlays: number;
  uniqueTracks: number;
  topTracks: Array<{ track: MusicTrackDto; seconds: number; plays: number }>;
  topAlbums: Array<{
    id: string;
    title: string;
    artworkUrl: string | null;
    seconds: number;
    plays: number;
  }>;
  topArtists: Array<{
    id: string;
    name: string;
    artworkUrl: string | null;
    seconds: number;
    plays: number;
  }>;
  hours: Array<{ hour: number; seconds: number; plays: number }>;
  weekdays: Array<{ day: number; seconds: number; plays: number }>;
  genres: Array<{ name: string; seconds: number }>;
}

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


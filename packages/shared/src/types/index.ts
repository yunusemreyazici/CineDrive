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

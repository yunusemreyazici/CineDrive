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

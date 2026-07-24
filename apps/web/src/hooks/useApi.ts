import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, parseApiError } from '../api/client';
import type {
  LoginInput,
  UserDto,
  MediaQueryInput,
  CreateLibraryInput,
  UpdateProgressInput,
} from '@cinedrive/shared';
import type { MediaItemType, WatchHistoryType, LibraryScanType, EpisodeType } from '../types/media';

// --- AUTH HOOKS ---
export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const res = await apiClient.get<{ authenticated: boolean; user: UserDto | null }>(
        '/auth/session',
      );
      return res.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: LoginInput) => {
      try {
        const res = await apiClient.post<{ user: UserDto }>('/auth/login', data);
        return res.data.user;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout');
    },
    onSuccess: () => {
      queryClient.setQueryData(['session'], { authenticated: false, user: null });
      queryClient.clear();
    },
  });
}

export function useGoogleStatusQuery() {
  return useQuery({
    queryKey: ['googleStatus'],
    queryFn: async () => {
      const res = await apiClient.get<{ connected: boolean; connection: { googleEmail?: string; updatedAt: string } | null }>('/auth/google/status');
      return res.data;
    },
  });
}

export function useUnlinkGoogleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/auth/google');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['googleStatus'] });
    },
  });
}

// --- LIBRARY HOOKS ---
export function useLibrariesQuery() {
  return useQuery({
    queryKey: ['libraries'],
    queryFn: async () => {
      const res = await apiClient.get<{ libraries: { id: string; name: string; rootFolderId: string }[] }>('/libraries');
      return res.data.libraries;
    },
  });
}

export function useCreateLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLibraryInput) => {
      const res = await apiClient.post<{ library: { id: string; name: string } }>('/libraries', data);
      return res.data.library;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    },
  });
}

export function useScanLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (libraryId: string) => {
      try {
        const res = await apiClient.post<{ scan: LibraryScanType }>(`/libraries/${libraryId}/scan`);
        return res.data.scan;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: (_, libraryId) => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      queryClient.invalidateQueries({ queryKey: ['libraryScans', libraryId] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useLibraryScansQuery(libraryId?: string) {
  return useQuery({
    queryKey: ['libraryScans', libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const res = await apiClient.get<{ scans: LibraryScanType[] }>(`/libraries/${libraryId}/scans`);
      return res.data.scans;
    },
    enabled: !!libraryId,
  });
}

// --- MEDIA HOOKS ---
export function useMediaListQuery(params?: Partial<MediaQueryInput>) {
  return useQuery({
    queryKey: ['media', params],
    queryFn: async () => {
      const res = await apiClient.get<{ media: MediaItemType[]; pagination: { total: number; page: number; limit: number; totalPages: number } }>('/media', {
        params,
      });
      return res.data;
    },
  });
}

export function useMediaDetailQuery(mediaId?: string) {
  return useQuery({
    queryKey: ['mediaDetail', mediaId],
    queryFn: async () => {
      if (!mediaId) return null;
      const res = await apiClient.get<{ media: MediaItemType }>(`/media/${mediaId}`);
      return res.data.media;
    },
    enabled: !!mediaId,
  });
}

// --- PLAYBACK & HISTORY HOOKS ---
export interface ContinueWatchingItemType {
  id: string;
  mediaItemId: string;
  episodeId?: string;
  mediaItem?: MediaItemType;
  episode?: EpisodeType;
  positionSeconds: number;
  durationSeconds: number;
  percentage: number;
  completed: boolean;
  continueUrl: string;
}

export function useContinueWatchingQuery() {
  return useQuery({
    queryKey: ['continueWatching'],
    queryFn: async () => {
      const res = await apiClient.get<{ items: ContinueWatchingItemType[] }>('/playback/continue');
      return res.data.items;
    },
  });
}

export function useWatchHistoryQuery() {
  return useQuery({
    queryKey: ['watchHistory'],
    queryFn: async () => {
      const res = await apiClient.get<{ history: WatchHistoryType[] }>('/playback/history');
      return res.data.history;
    },
  });
}

export function useDeleteHistoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (historyId: string) => {
      await apiClient.delete(`/playback/history/${historyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchHistory'] });
    },
  });
}

export function useUpdateProgressMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateProgressInput) => {
      const res = await apiClient.put('/playback/progress', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['continueWatching'] });
      queryClient.invalidateQueries({ queryKey: ['watchHistory'] });
    },
  });
}

// --- FAVORITES HOOKS WITH OPTIMISTIC UPDATES ---
export function useFavoritesQuery() {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const res = await apiClient.get<{ favorites: MediaItemType[] }>('/favorites');
      return res.data.favorites;
    },
  });
}

export function useToggleFavoriteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mediaItemId, isFavorite }: { mediaItemId: string; isFavorite: boolean }) => {
      if (isFavorite) {
        await apiClient.delete(`/favorites/${mediaItemId}`);
      } else {
        await apiClient.post(`/favorites/${mediaItemId}`);
      }
    },
    onMutate: async ({ mediaItemId, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ['favorites'] });
      await queryClient.cancelQueries({ queryKey: ['mediaDetail', mediaItemId] });

      const previousFavorites = queryClient.getQueryData<MediaItemType[]>(['favorites']);
      const previousDetail = queryClient.getQueryData<MediaItemType>(['mediaDetail', mediaItemId]);

      // Optimistically update media detail
      if (previousDetail) {
        queryClient.setQueryData<MediaItemType>(['mediaDetail', mediaItemId], (old) =>
          old ? { ...old, isFavorite: !isFavorite } : old,
        );
      }

      return { previousFavorites, previousDetail };
    },
    onError: (_err, { mediaItemId }, context) => {
      if (context?.previousFavorites) {
        queryClient.setQueryData(['favorites'], context.previousFavorites);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(['mediaDetail', mediaItemId], context.previousDetail);
      }
    },
    onSettled: (_data, _error, { mediaItemId }) => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['mediaDetail', mediaItemId] });
    },
  });
}

// --- SETTINGS HOOKS ---
export interface OpenSubtitlesSettingsDto {
  apiKey: string;
  username: string;
  preferredLanguages: string;
  hasApiKey: boolean;
}

export function useOpenSubtitlesSettingsQuery() {
  return useQuery({
    queryKey: ['openSubtitlesSettings'],
    queryFn: async () => {
      const res = await apiClient.get<OpenSubtitlesSettingsDto>('/settings/opensubtitles');
      return res.data;
    },
  });
}

export function useUpdateOpenSubtitlesSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { apiKey?: string; username?: string; password?: string; preferredLanguages?: string }) => {
      const res = await apiClient.put<OpenSubtitlesSettingsDto>('/settings/opensubtitles', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openSubtitlesSettings'] });
    },
  });
}

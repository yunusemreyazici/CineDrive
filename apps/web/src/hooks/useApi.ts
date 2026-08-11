import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, parseApiError } from '../api/client';
import type {
  LoginInput,
  UserDto,
  MediaQueryInput,
  CreateLibraryInput,
  LibraryDto,
  UpdateLibraryInput,
  DriveScanSourceDto,
  UpdateProgressInput,
  UpdateMediaMetadataInput,
} from '@cinedrive/shared';
import type { MediaItemType, WatchHistoryType, LibraryScanType, EpisodeType } from '../types/media';
import { useUiStore } from '../stores/useUiStore';

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
      const res = await apiClient.get<{
        connected: boolean;
        connection: { id?: string; email?: string; updatedAt: string } | null;
        connections?: Array<{ id: string; email: string; createdAt: string }>;
      }>('/auth/google/status');
      return res.data;
    },
  });
}

export function useGoogleConnectionsQuery() {
  return useQuery({
    queryKey: ['googleConnections'],
    queryFn: async () => {
      const res = await apiClient.get<{
        connections: Array<{ id: string; email: string; createdAt: string }>;
      }>('/auth/google/connections');
      return res.data.connections || [];
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
      queryClient.invalidateQueries({ queryKey: ['googleConnections'] });
    },
  });
}

export function useUnlinkGoogleConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/auth/google/connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['googleStatus'] });
      queryClient.invalidateQueries({ queryKey: ['googleConnections'] });
    },
  });
}

// --- LIBRARY HOOKS ---
export function useLibrariesQuery() {
  return useQuery({
    queryKey: ['libraries'],
    queryFn: async () => {
      const res = await apiClient.get<{
        libraries: LibraryDto[];
      }>('/libraries');
      return res.data.libraries;
    },
  });
}

export function useUpdateLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLibraryInput }) => {
      try {
        const res = await apiClient.patch<{ library: LibraryDto }>(`/libraries/${id}`, data);
        return res.data.library;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    },
  });
}

export function useCreateLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLibraryInput) => {
      const res = await apiClient.post<{ library: { id: string; name: string } }>(
        '/libraries',
        data,
      );
      return res.data.library;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    },
  });
}

export function useDeleteLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (libraryId: string) => {
      const res = await apiClient.delete<{
        removed: { library: number; media: number; files: number };
      }>(`/libraries/${libraryId}`);
      return res.data.removed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['database-stats'] });
    },
  });
}

export function useDriveScanSourcesQuery(libraryId?: string) {
  return useQuery({
    queryKey: ['driveScanSources', libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const res = await apiClient.get<{ sources: DriveScanSourceDto[] }>(
        `/libraries/${libraryId}/drive-sources`,
      );
      return res.data.sources;
    },
    enabled: !!libraryId,
  });
}

export function useCreateDriveScanSourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ libraryId, googleConnectionId, rootFolderId }: { libraryId: string; googleConnectionId: string; rootFolderId: string }) => {
      const res = await apiClient.post<{ source: DriveScanSourceDto }>(
        `/libraries/${libraryId}/drive-sources`,
        { googleConnectionId, rootFolderId },
      );
      return res.data.source;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['driveScanSources', variables.libraryId] });
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
    },
  });
}

export function useDeleteDriveScanSourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ libraryId, sourceId }: { libraryId: string; sourceId: string }) => {
      const res = await apiClient.delete<{ removed: { media: number; files: number } }>(
        `/libraries/${libraryId}/drive-sources/${sourceId}`,
      );
      return res.data.removed;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['driveScanSources', variables.libraryId] });
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useScanDriveSourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ libraryId, sourceId }: { libraryId: string; sourceId: string }) => {
      try {
        const res = await apiClient.post<{ scan: LibraryScanType }>(
          `/libraries/${libraryId}/drive-sources/${sourceId}/scan`,
          {},
        );
        return res.data.scan;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['libraryScans', variables.libraryId] });
    },
  });
}

/**
 * The server answers 202 as soon as the scan is registered and does the work in
 * the background, so this no longer needs a long timeout — progress arrives
 * through `useLibraryScansQuery`.
 */
export function useScanLibraryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (libraryId: string) => {
      try {
        const res = await apiClient.post<{ scan: LibraryScanType }>(
          `/libraries/${libraryId}/scan`,
          {},
        );
        return res.data.scan;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: (_, libraryId) => {
      // Only the scan list is meaningful right now; the media list is
      // refreshed by the poller once the scan actually finishes.
      queryClient.invalidateQueries({ queryKey: ['libraryScans', libraryId] });
    },
  });
}

const SCAN_POLL_INTERVAL_MS = 2000;

export function useLibraryScansQuery(libraryId?: string) {
  const queryClient = useQueryClient();
  const wasRunningRef = useRef(false);

  const query = useQuery({
    queryKey: ['libraryScans', libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const res = await apiClient.get<{ scans: LibraryScanType[] }>(
        `/libraries/${libraryId}/scans`,
      );
      return res.data.scans || [];
    },
    enabled: !!libraryId,
    refetchInterval: (query) => {
      const latestScan = query.state.data?.[0];
      return latestScan?.status === 'running' ? SCAN_POLL_INTERVAL_MS : false;
    },
  });

  // A background scan finishing is the moment the library actually changed, so
  // that is when the media views need refreshing.
  const isRunning = query.data?.[0]?.status === 'running';
  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      queryClient.invalidateQueries({ queryKey: ['driveScanSources', libraryId] });
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, libraryId, queryClient]);

  return query;
}

export interface DatabaseStats {
  libraries: number;
  driveFiles: number;
  movies: number;
  series: number;
  episodes: number;
  subtitles: number;
  watchHistory: number;
  favorites: number;
  scans: number;
  orphanMedia: number;
  sizeBytes: number;
}

export function useDatabaseStatsQuery() {
  return useQuery({
    queryKey: ['database-stats'],
    queryFn: async () =>
      (await apiClient.get<{ stats: DatabaseStats }>('/settings/database/stats')).data.stats,
  });
}

export function useDatabaseCleanupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<{ removed: { media: number; staleScans: number } }>(
          '/settings/database/cleanup',
        )
      ).data.removed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['database-stats'] });
      queryClient.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useClearDatabaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        const res = await apiClient.delete<{
          removed: { media: number; files: number };
        }>('/settings/database/clear');
        return res.data;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      queryClient.resetQueries();
    },
  });
}

// --- MEDIA HOOKS ---
export function useUpdateMediaMetadataMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateMediaMetadataInput }) => {
      try {
        const res = await apiClient.patch<{ mediaItem: MediaItemType }>(`/media/${id}`, data);
        return res.data.mediaItem;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: (updatedItem) => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['mediaDetail', updatedItem.id] });
    },
  });
}

export function useDeleteMediaItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mediaItemId: string) => {
      try {
        const res = await apiClient.delete<{ message: string }>(`/media/${mediaItemId}`);
        return res.data;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['mediaDetail'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}

export function useBatchDeleteMediaMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      try {
        const res = await apiClient.post<{ message: string; deletedCount: number }>(
          '/media/batch-delete',
          { ids },
        );
        return res.data;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['mediaDetail'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}

export function useAutoDownloadSubtitleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      mediaId,
      seasonNumber,
      episodeNumber,
      // Omitted by default so the server falls back to the account's own
      // subtitle language preference instead of assuming Turkish.
      language,
    }: {
      mediaId: string;
      seasonNumber?: number;
      episodeNumber?: number;
      language?: string;
    }) => {
      try {
        const res = await apiClient.post<{ message: string; subtitleTrack: unknown }>(
          `/media/${mediaId}/auto-subtitle`,
          { seasonNumber, episodeNumber, language },
        );
        return res.data;
      } catch (err) {
        throw parseApiError(err);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['mediaDetail', variables.mediaId] });
    },
  });
}
export function useMediaListQuery(
  params?: Partial<MediaQueryInput>,
  options?: { respectVisibilityPreference?: boolean; enabled?: boolean },
) {
  const hideMoviesWithoutMetadata = useUiStore((state) => state.hideMoviesWithoutMetadata);
  const respectVisibilityPreference = options?.respectVisibilityPreference !== false;
  const effectiveParams = respectVisibilityPreference
    ? { ...params, hideWithoutMetadata: hideMoviesWithoutMetadata }
    : params;

  return useQuery({
    queryKey: ['media', effectiveParams],
    queryFn: async () => {
      const res = await apiClient.get<{
        media: MediaItemType[];
        pagination: { total: number; page: number; limit: number; totalPages: number };
      }>('/media', {
        params: effectiveParams,
      });
      return res.data;
    },
    enabled: options?.enabled !== false,
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

export function useResetProgressMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mediaItemId: string) => {
      await apiClient.delete(`/playback/${mediaItemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['continueWatching'] });
      queryClient.invalidateQueries({ queryKey: ['watchHistory'] });
    },
  });
}

export function useWatchHistoryQuery() {
  return useQuery({
    queryKey: ['watchHistory'],
    queryFn: async () => {
      const res = await apiClient.get<{ history: WatchHistoryType[] }>('/history');
      return res.data.history || [];
    },
  });
}

export function useDeleteHistoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (historyId: string) => {
      await apiClient.delete(`/history/${historyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchHistory'] });
    },
  });
}

export function useClearWatchHistoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/history');
    },
    onSuccess: async () => {
      queryClient.setQueryData(['watchHistory'], []);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['watchHistory'] }),
        queryClient.invalidateQueries({ queryKey: ['continueWatching'] }),
        queryClient.invalidateQueries({ queryKey: ['media'] }),
        queryClient.invalidateQueries({ queryKey: ['mediaDetail'] }),
      ]);
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
    mutationFn: async ({
      mediaItemId,
      isFavorite,
    }: {
      mediaItemId: string;
      isFavorite: boolean;
    }) => {
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
    mutationFn: async (data: {
      apiKey?: string;
      username?: string;
      preferredLanguages?: string;
    }) => {
      const res = await apiClient.put<OpenSubtitlesSettingsDto>('/settings/opensubtitles', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openSubtitlesSettings'] });
    },
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiClient.put<{ user: UserDto; message: string }>('/auth/profile', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useChangePasswordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await apiClient.put<{ user: UserDto; message: string }>(
        '/auth/change-password',
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

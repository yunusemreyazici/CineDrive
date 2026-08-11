import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MusicAlbumDto,
  MusicArtistDto,
  MusicDiscoveryDto,
  MusicLyricsDto,
  MusicMaintenanceDto,
  MusicMixDto,
  MusicPlaybackStateDto,
  MusicReplayDto,
  MusicPlaylistDto,
  MusicTrackDto,
  UpdateMusicTrackMetadataInput,
} from '@cinedrive/shared';
import { apiClient, parseApiError, type QueryParams } from '../api/client';

export interface MusicOverview {
  recentTracks: MusicTrackDto[];
  recentAlbums: MusicAlbumDto[];
  artists: MusicArtistDto[];
  playlists: MusicPlaylistDto[];
  recentHistory: Array<{
    id: string;
    playedAt: string;
    listenedSeconds: number;
    track: MusicTrackDto;
  }>;
  favoriteCount: number;
}

export interface MusicAlbumDetail extends MusicAlbumDto {
  tracks: MusicTrackDto[];
  totalDuration: number;
  discCount: number;
  qualitySummary: { formats: string[]; lossless: boolean; hiRes: boolean };
  similarAlbums: MusicAlbumDto[];
}

export interface MusicArtistDetail extends MusicArtistDto {
  albums: MusicAlbumDto[];
  tracks: MusicTrackDto[];
  similarArtists: MusicArtistDto[];
}

export const useMusicOverviewQuery = () =>
  useQuery({
    queryKey: ['music', 'overview'],
    queryFn: async () => (await apiClient.get<MusicOverview>('/music/overview')).data,
  });

export const useMusicDiscoveryQuery = () =>
  useQuery({
    queryKey: ['music', 'discovery'],
    queryFn: async () => (await apiClient.get<MusicDiscoveryDto>('/music/discovery')).data,
    staleTime: 5 * 60 * 1000,
  });

export const useMusicReplayQuery = (period: 'week' | 'month' | 'year', year?: number) =>
  useQuery({
    queryKey: ['music', 'replay', period, year],
    queryFn: async () =>
      (await apiClient.get<MusicReplayDto>('/music/replay', { params: { period, ...(year ? { year } : {}) } })).data,
  });

export const useArtistRadioMutation = () =>
  useMutation({
    mutationFn: async (artistId: string) =>
      (await apiClient.get<{ mix: MusicMixDto }>(`/music/radio/${artistId}`)).data.mix,
  });

export const useMusicTracksQuery = (params?: QueryParams) =>
  useQuery({
    queryKey: ['music', 'tracks', params],
    queryFn: async () =>
      (
        await apiClient.get<{
          tracks: MusicTrackDto[];
          pagination: { total: number; page: number; limit: number; totalPages: number };
        }>('/music/tracks', { params })
      ).data,
  });

export const useMusicAlbumsQuery = (params?: QueryParams) =>
  useQuery({
    queryKey: ['music', 'albums', params],
    queryFn: async () =>
      (await apiClient.get<{ albums: MusicAlbumDto[] }>('/music/albums', { params })).data.albums,
  });

export const useMusicAlbumQuery = (id?: string) =>
  useQuery({
    queryKey: ['music', 'album', id],
    enabled: !!id,
    queryFn: async () =>
      (await apiClient.get<{ album: MusicAlbumDetail }>(`/music/albums/${id}`)).data.album,
  });

export const useMusicArtistsQuery = () =>
  useQuery({
    queryKey: ['music', 'artists'],
    queryFn: async () =>
      (await apiClient.get<{ artists: MusicArtistDto[] }>('/music/artists')).data.artists,
  });

export const useMusicArtistQuery = (id?: string) =>
  useQuery({
    queryKey: ['music', 'artist', id],
    enabled: !!id,
    queryFn: async () =>
      (
        await apiClient.get<{
          artist: MusicArtistDetail;
        }>(`/music/artists/${id}`)
      ).data.artist,
  });

export const useMusicFavoritesQuery = () =>
  useQuery({
    queryKey: ['music', 'favorites'],
    queryFn: async () =>
      (await apiClient.get<{ tracks: MusicTrackDto[] }>('/music/favorites')).data.tracks,
  });

export const useMusicTrackQuery = (id?: string) =>
  useQuery({
    queryKey: ['music', 'track', id],
    enabled: !!id,
    queryFn: async () =>
      (await apiClient.get<{ track: MusicTrackDto }>(`/music/tracks/${id}`)).data.track,
  });

export const useUpdateMusicTrackMetadataMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      trackId,
      metadata,
    }: {
      trackId: string;
      metadata: UpdateMusicTrackMetadataInput;
    }) =>
      (
        await apiClient.patch<{ track: MusicTrackDto }>(
          `/music/tracks/${trackId}/metadata`,
          metadata,
        )
      ).data.track,
    onSuccess: (track) => {
      client.setQueryData(['music', 'track', track.id], track);
      void client.invalidateQueries({ queryKey: ['music'] });
    },
  });
};

export const useRematchMusicTrackMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (trackId: string) =>
      (
        await apiClient.post<{
          matchStatus: 'matched' | 'not_found';
          track: MusicTrackDto | null;
        }>(`/music/tracks/${trackId}/rematch`)
      ).data,
    onSuccess: (result, trackId) => {
      if (result.track) client.setQueryData(['music', 'track', trackId], result.track);
      void client.invalidateQueries({ queryKey: ['music'] });
    },
  });
};

export const useMusicHistoryQuery = () =>
  useQuery({
    queryKey: ['music', 'history'],
    queryFn: async () =>
      (
        await apiClient.get<{
          history: Array<{
            id: string;
            playedAt: string;
            listenedSeconds: number;
            track: MusicTrackDto;
          }>;
        }>('/music/history')
      ).data.history,
  });

export const useMusicLyricsQuery = (trackId?: string, enabled = true) =>
  useQuery({
    queryKey: ['music', 'lyrics', trackId],
    enabled: !!trackId && enabled,
    queryFn: async () => {
      const local = (
        await apiClient.get<{ lyrics: MusicLyricsDto | null }>(`/music/tracks/${trackId}/lyrics`)
      ).data.lyrics;
      if (local) return local;
      return (
        await apiClient.post<{
          lyrics: MusicLyricsDto | null;
          lookupStatus:
            'found' | 'existing' | 'not_found' | 'insufficient_metadata' | 'unavailable';
        }>(`/music/tracks/${trackId}/lyrics/lookup`)
      ).data.lyrics;
    },
    staleTime: 5 * 60 * 1000,
  });

export const useUpdateMusicLyricsMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      trackId,
      content,
      translatedContent,
      romanizedContent,
      language,
      translationLanguage,
    }: {
      trackId: string;
      content: string;
      translatedContent?: string | null;
      romanizedContent?: string | null;
      language?: string | null;
      translationLanguage?: string | null;
    }) =>
      (
        await apiClient.put<{ lyrics: MusicLyricsDto }>(`/music/tracks/${trackId}/lyrics`, {
          content,
          translatedContent,
          romanizedContent,
          language,
          translationLanguage,
          sourceName: 'manual.lrc',
        })
      ).data.lyrics,
    onSuccess: (lyrics, variables) => {
      client.setQueryData(['music', 'lyrics', variables.trackId], lyrics);
    },
  });
};

export const useWriteLyricsSidecarMutation = () =>
  useMutation({
    mutationFn: async (trackId: string) =>
      (await apiClient.post<{ path: string }>(`/music/tracks/${trackId}/lyrics/sidecar`)).data,
  });

export const useAutoTranslateLyricsMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ trackId, language }: { trackId: string; language: string }) =>
      (await apiClient.post<{ lyrics: MusicLyricsDto }>(`/music/tracks/${trackId}/lyrics/translations/auto`, { language })).data.lyrics,
    onSuccess: (lyrics, input) => client.setQueryData(['music', 'lyrics', input.trackId], lyrics),
  });
};

export const useAlignLyricsMutation = () =>
  useMutation({
    mutationFn: async ({ trackId, content }: { trackId: string; content: string }) =>
      (await apiClient.post<{ content: string }>(`/music/tracks/${trackId}/lyrics/align`, { content })).data.content,
  });

export const useImportLyricsRevisionMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ trackId, sourceName, content }: { trackId: string; sourceName: string; content: string }) =>
      (await apiClient.post(`/music/tracks/${trackId}/lyrics/revisions`, { sourceName, content })).data,
    onSuccess: (_data, input) => void client.invalidateQueries({ queryKey: ['music', 'lyrics', input.trackId] }),
  });
};

export const useApplyLyricsRevisionMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ trackId, revisionId }: { trackId: string; revisionId: string }) =>
      (await apiClient.post<{ lyrics: MusicLyricsDto }>(`/music/tracks/${trackId}/lyrics/revisions/${revisionId}/apply`)).data.lyrics,
    onSuccess: (lyrics, input) => client.setQueryData(['music', 'lyrics', input.trackId], lyrics),
  });
};

export const useMusicMaintenanceQuery = () =>
  useQuery({
    queryKey: ['music', 'maintenance'],
    queryFn: async () => (await apiClient.get<MusicMaintenanceDto>('/music/maintenance')).data,
  });

export const useGenerateMusicMaintenanceMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<{ generated: number }>('/music/maintenance/suggestions/generate', {})).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music', 'maintenance'] }),
  });
};

export const useResolveMusicSuggestionMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) =>
      (await apiClient.post(`/music/maintenance/suggestions/${id}/${accept ? 'accept' : 'reject'}`)).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useArchiveDuplicateMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { keepTrackId: string; archiveTrackId: string; replacePlaylistItems: boolean }) =>
      (await apiClient.post('/music/maintenance/duplicates/archive', input)).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useUndoMusicMaintenanceMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/music/maintenance/actions/${id}/undo`)).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useBulkMusicMetadataMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      trackIds: string[];
      artist?: string;
      album?: string;
      albumArtist?: string;
      genres?: string[];
      year?: number | null;
      metadataLocked?: boolean;
    }) => (await apiClient.patch<{ updated: number }>('/music/maintenance/tracks', input)).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useReplayGainScanMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (trackIds: string[]) =>
      (
        await apiClient.post<{ updated: string[]; skipped: string[] }>(
          '/music/maintenance/replaygain',
          { trackIds },
        )
      ).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useFingerprintScanMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { trackIds: string[]; force?: boolean }) =>
      (
        await apiClient.post<{
          analyzed: string[];
          identified: string[];
          skipped: Array<{ trackId: string; reason: string }>;
          available: boolean;
          acoustidConfigured: boolean;
        }>('/music/maintenance/fingerprints', input)
      ).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useEditMusicAlbumMaintenanceMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      title?: string;
      artist?: string;
      year?: number | null;
      genres?: string[];
      releaseType?: string;
    }) => (await apiClient.patch(`/music/maintenance/albums/${id}`, input)).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useEditMusicArtistMaintenanceMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      sortName,
    }: {
      id: string;
      name: string;
      sortName?: string | null;
    }) => (await apiClient.patch(`/music/maintenance/artists/${id}`, { name, sortName })).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['music'] }),
  });
};

export const useMusicPlaylistsQuery = () =>
  useQuery({
    queryKey: ['music', 'playlists'],
    queryFn: async () =>
      (await apiClient.get<{ playlists: MusicPlaylistDto[] }>('/music/playlists')).data.playlists,
  });

export const useMusicPlaylistQuery = (id?: string) =>
  useQuery({
    queryKey: ['music', 'playlist', id],
    enabled: !!id,
    queryFn: async () =>
      (await apiClient.get<{ playlist: MusicPlaylistDto }>(`/music/playlists/${id}`)).data.playlist,
  });

export const useCreateMusicPlaylistMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) =>
      (await apiClient.post<{ playlist: MusicPlaylistDto }>('/music/playlists', input)).data
        .playlist,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['music'] });
    },
  });
};

export const useUpdateMusicPlaylistMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      playlistId,
      input,
    }: {
      playlistId: string;
      input: { name: string; description?: string | null };
    }) => apiClient.patch(`/music/playlists/${playlistId}`, input),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['music', 'playlist', variables.playlistId] });
      void client.invalidateQueries({ queryKey: ['music', 'playlists'] });
      void client.invalidateQueries({ queryKey: ['music', 'overview'] });
    },
  });
};

export const useDeleteMusicPlaylistMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (playlistId: string) => apiClient.delete(`/music/playlists/${playlistId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['music', 'playlists'] });
      void client.invalidateQueries({ queryKey: ['music', 'overview'] });
    },
  });
};

export const useAddPlaylistTrackMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      apiClient.post(`/music/playlists/${playlistId}/items`, { trackId }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['music', 'playlist', variables.playlistId] });
      void client.invalidateQueries({ queryKey: ['music', 'playlists'] });
    },
  });
};

export const useRemovePlaylistTrackMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, itemId }: { playlistId: string; itemId: string }) =>
      apiClient.delete(`/music/playlists/${playlistId}/items/${itemId}`),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['music', 'playlist', variables.playlistId] });
    },
  });
};

export const useReorderPlaylistMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ playlistId, itemIds }: { playlistId: string; itemIds: string[] }) =>
      apiClient.put(`/music/playlists/${playlistId}/reorder`, { itemIds }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['music', 'playlist', variables.playlistId] });
    },
  });
};

export const useToggleMusicFavoriteMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ trackId, favorite }: { trackId: string; favorite: boolean }) => {
      try {
        return favorite
          ? await apiClient.delete(`/music/favorites/${trackId}`)
          : await apiClient.post(`/music/favorites/${trackId}`);
      } catch (error) {
        throw parseApiError(error);
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['music'] });
    },
  });
};

export const fetchMusicPlaybackState = async () =>
  (await apiClient.get<{ state: MusicPlaybackStateDto }>('/music/playback-state')).data.state;

export const saveMusicPlaybackState = async (
  state: Omit<MusicPlaybackStateDto, 'queue'> & {
    queue: Array<{ id: string; trackId: string; sourceOrder: number; playOrder: number }>;
  },
) => (await apiClient.put<{ revision: number }>('/music/playback-state', state)).data;

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MusicAlbumDto,
  MusicArtistDto,
  MusicLyricsDto,
  MusicPlaybackStateDto,
  MusicPlaylistDto,
  MusicTrackDto,
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

export const useMusicOverviewQuery = () =>
  useQuery({
    queryKey: ['music', 'overview'],
    queryFn: async () => (await apiClient.get<MusicOverview>('/music/overview')).data,
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
      (
        await apiClient.get<{ album: MusicAlbumDto & { tracks: MusicTrackDto[] } }>(
          `/music/albums/${id}`,
        )
      ).data.album,
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
          artist: MusicArtistDto & { albums: MusicAlbumDto[]; tracks: MusicTrackDto[] };
        }>(`/music/artists/${id}`)
      ).data.artist,
  });

export const useMusicFavoritesQuery = () =>
  useQuery({
    queryKey: ['music', 'favorites'],
    queryFn: async () =>
      (await apiClient.get<{ tracks: MusicTrackDto[] }>('/music/favorites')).data.tracks,
  });

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

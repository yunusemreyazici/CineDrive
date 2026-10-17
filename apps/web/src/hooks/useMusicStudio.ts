import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  StudioChangesDto,
  StudioHealthDto,
  StudioHistoryDto,
  StudioPlaylistDirectoryDto,
  StudioWorkshopDto,
  MusicStudioDto,
} from '@cinedrive/shared';
import { apiClient } from '../api/client';
import type { MusicTracksPageResponse } from './useMusicApi';

export const studioKey = (owner: string) => ['music-studio', owner] as const;
/** Account-scoped, bounded lookup shared by workshop and recording-family editors. */
export function useStudioTrackSearch(owner: string, input: string) {
  const search = input.trim();
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  return useQuery({
    queryKey: [...studioKey(owner), 'search', search],
    enabled: search.length >= 2 && search === settled,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<MusicTracksPageResponse>('/music/tracks', {
          signal,
          params: { search, limit: 20, page: 1 },
        })
      ).data,
    staleTime: 30_000,
  });
}
export function useStudioDirectory(owner: string) {
  return useInfiniteQuery({
    queryKey: [...studioKey(owner), 'directory'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await apiClient.get<StudioPlaylistDirectoryDto>('/music/studio/playlists', {
          signal,
          params: { limit: 50, cursor: pageParam },
        })
      ).data,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function useStudioDetail(owner: string, id: string) {
  return useQuery({
    queryKey: [...studioKey(owner), 'playlist', id],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudioWorkshopDto>(
          `/music/studio/playlists/${encodeURIComponent(id)}`,
          { signal },
        )
      ).data,
    retry: false,
  });
}
export function useStudioHistory(owner: string, id: string) {
  return useInfiniteQuery({
    queryKey: [...studioKey(owner), 'history', id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await apiClient.get<StudioHistoryDto>(
          `/music/studio/playlists/${encodeURIComponent(id)}/history`,
          { signal, params: { cursor: pageParam } },
        )
      ).data,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}
export function useStudioProfile(owner: string) {
  return useQuery({
    queryKey: [...studioKey(owner), 'profile'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<MusicStudioDto>('/music/studio/profile', { signal })).data,
  });
}
export function useStudioHealth(owner: string) {
  return useQuery({
    queryKey: [...studioKey(owner), 'health'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<StudioHealthDto>('/music/studio/health', { signal })).data,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
}
export function useStudioWrite(owner: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      path: string;
      method?: 'post' | 'put' | 'delete';
      body?: unknown;
    }) => {
      const method = input.method ?? 'post';
      return method === 'delete'
        ? (await apiClient.delete(input.path)).data
        : (await apiClient[method](input.path, input.body)).data;
    },
    retry: false,
    onSuccess: (_result, input) => {
      const match = input.path.match(/^\/music\/studio\/playlists\/([^/]+)/);
      if (match) {
        const id = decodeURIComponent(match[1]!);
        void client.invalidateQueries({ queryKey: [...studioKey(owner), 'playlist', id] });
        void client.invalidateQueries({ queryKey: [...studioKey(owner), 'history', id] });
        if (
          input.body &&
          typeof input.body === 'object' &&
          'targetId' in input.body &&
          typeof input.body.targetId === 'string'
        ) {
          void client.invalidateQueries({
            queryKey: [...studioKey(owner), 'playlist', input.body.targetId],
          });
          void client.invalidateQueries({
            queryKey: [...studioKey(owner), 'history', input.body.targetId],
          });
        }
      }
      if (input.path.includes('/playlists')) {
        void client.invalidateQueries({ queryKey: [...studioKey(owner), 'directory'] });
        void client.invalidateQueries({ queryKey: ['music', 'playlists'] });
      } else
        void client.invalidateQueries({
          queryKey: [...studioKey(owner), input.path.endsWith('/profile') ? 'profile' : 'health'],
        });
    },
  });
}

/** Visible-page polling with persistent server cursors: catch up on focus/reconnect,
 * no catalogue refresh, no background poll and no stream or credentials in events. */
export function useStudioChanges(owner: string) {
  const client = useQueryClient();
  const cursor = useRef<number | undefined>(undefined);
  useEffect(() => {
    cursor.current = undefined;
    let stopped = false;
    let active = false;
    const controller = new AbortController();
    const poll = async () => {
      if (stopped || active || document.hidden) return;
      active = true;
      try {
        for (let page = 0; page < 20 && !stopped; page++) {
          const { data } = await apiClient.get<StudioChangesDto>('/music/studio/changes', {
            signal: controller.signal,
            params: { cursor: cursor.current },
          });
          if (stopped) return;
          const initial = cursor.current === undefined;
          cursor.current = data.cursor;
          if (initial || data.resetRequired) {
            // Subscribe first, then refresh: no gap between baseline reads and feed cursor.
            await client.resetQueries({ queryKey: [...studioKey(owner), 'playlist'] });
            await client.resetQueries({ queryKey: [...studioKey(owner), 'history'] });
            void client.invalidateQueries({ queryKey: studioKey(owner) });
          }
          // A burst of edits to one playlist needs one refresh, not one HTTP
          // request per event. Preserve revocations even if a later edit follows.
          const affected = new Map<string, StudioChangesDto['changes'][number]>();
          for (const change of data.changes) {
            const previous = affected.get(change.playlistId);
            if (!previous || !['membership', 'delete'].includes(previous.kind))
              affected.set(change.playlistId, change);
          }
          for (const change of affected.values()) {
            if (change.kind === 'membership' || change.kind === 'delete') {
              // Reset notifies mounted observers immediately; removing a query alone
              // can leave its old observer displaying revoked metadata until remount.
              await Promise.all([
                client.resetQueries({
                  queryKey: [...studioKey(owner), 'playlist', change.playlistId],
                }),
                client.resetQueries({
                  queryKey: [...studioKey(owner), 'history', change.playlistId],
                }),
              ]);
              continue;
            }
            void client.invalidateQueries({
              queryKey: [...studioKey(owner), 'playlist', change.playlistId],
            });
            void client.invalidateQueries({
              queryKey: [...studioKey(owner), 'history', change.playlistId],
            });
          }
          if (data.changes.length)
            void client.invalidateQueries({ queryKey: [...studioKey(owner), 'directory'] });
          if (!data.hasMore) break;
        }
      } catch {
        /* Preserve cursor; retry on reconnect/focus/timer, never repeat writes. */
      } finally {
        active = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 10000);
    window.addEventListener('online', poll);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('online', poll);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
      client.removeQueries({ queryKey: studioKey(owner) });
    };
  }, [client, owner]);
}

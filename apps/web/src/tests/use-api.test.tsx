import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ApiRequestError, apiClient, parseApiError } from '../api/client';
import { useLoginMutation, useToggleFavoriteMutation, useMediaListQuery } from '../hooks/useApi';
import { useUiStore } from '../stores/useUiStore';
import { createTestQueryClient } from './helpers/renderWithProviders';
import type { MediaItemType } from '../types/media';

describe('useLoginMutation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cancels a pre-login session request so its late response cannot overwrite the verified session', async () => {
    const queryClient = createTestQueryClient();
    const anonymous = { authenticated: false, user: null, authMode: 'single-user' };
    const user = { id: 'admin-1' };
    const session = { ...anonymous, authenticated: true, user };
    queryClient.setQueryData(['session'], anonymous);
    let oldSignal: AbortSignal | undefined;
    let resolveOld: (() => void) | undefined;
    const oldRequest = queryClient
      .fetchQuery({
        queryKey: ['session'],
        staleTime: 0,
        queryFn: ({ signal }) => {
          oldSignal = signal;
          return new Promise((resolve) => {
            resolveOld = () => resolve(anonymous);
          });
        },
      })
      .catch(() => undefined);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user } } as never);
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: session } as never);
    const { result } = renderHook(() => useLoginMutation(), { wrapper });
    result.current.mutate({ email: 'admin@example.com', password: 'password123' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(oldSignal?.aborted).toBe(true);
    expect(get).toHaveBeenCalledWith('/auth/session', { signal: expect.any(AbortSignal) });
    await act(async () => {
      resolveOld?.();
      await oldRequest;
    });
    expect(queryClient.getQueryData(['session'])).toEqual(session);
    queryClient.clear();
  });

  it('rejects a verified session belonging to a different account', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user: { id: 'new-user' } } } as never);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { authenticated: true, user: { id: 'old-user' }, authMode: 'multi-user' },
    } as never);
    const { result } = renderHook(() => useLoginMutation(), { wrapper });
    const onSuccess = vi.fn();
    result.current.mutate({ email: 'user@example.com', password: 'password123' }, { onSuccess });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(parseApiError(result.current.error).status).toBe(401);
    queryClient.clear();
  });

  it('preserves the structured API error for the login page', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const error = new ApiRequestError(
      503,
      {
        error: {
          code: 'DATABASE_BUSY',
          message: 'Veritabanı geçici olarak meşgul.',
          requestId: 'request-1',
        },
      },
      'Veritabanı geçici olarak meşgul.',
    );
    vi.spyOn(apiClient, 'post').mockRejectedValue(error);

    const { result } = renderHook(() => useLoginMutation(), { wrapper });
    result.current.mutate({ email: 'admin@example.com', password: 'password123' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
    expect(parseApiError(result.current.error)).toMatchObject({
      status: 503,
      code: 'DATABASE_BUSY',
      message: 'Veritabanı geçici olarak meşgul.',
    });
  });
});

const movie: MediaItemType = {
  id: 'media_1',
  type: 'movie',
  title: 'Inception',
  normalizedTitle: 'inception',
  isFavorite: false,
};

describe('useToggleFavoriteMutation', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = createTestQueryClient();
    queryClient.setQueryData(['mediaDetail', movie.id], movie);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flips the cached detail before the request resolves', async () => {
    let resolveRequest: (() => void) | undefined;
    vi.spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = () => resolve({ data: {} } as never);
        }),
    );

    const { result } = renderHook(() => useToggleFavoriteMutation(), { wrapper });
    result.current.mutate({ mediaItemId: movie.id, isFavorite: false });

    await waitFor(() => {
      const cached = queryClient.getQueryData<MediaItemType>(['mediaDetail', movie.id]);
      expect(cached?.isFavorite).toBe(true);
    });

    resolveRequest?.();
  });

  it('rolls the cache back when the request fails', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useToggleFavoriteMutation(), { wrapper });
    result.current.mutate({ mediaItemId: movie.id, isFavorite: false });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<MediaItemType>(['mediaDetail', movie.id]);
    expect(cached?.isFavorite).toBe(false);
  });

  it('deletes rather than posts when removing an existing favourite', async () => {
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} } as never);

    const { result } = renderHook(() => useToggleFavoriteMutation(), { wrapper });
    result.current.mutate({ mediaItemId: movie.id, isFavorite: true });

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`/favorites/${movie.id}`));
  });
});

describe('useMediaListQuery', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient = createTestQueryClient();
    useUiStore.getState().setHideMoviesWithoutMetadata(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the metadata visibility preference to the request', async () => {
    const getSpy = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: { media: [], pagination: {} } } as never);
    useUiStore.getState().setHideMoviesWithoutMetadata(true);

    renderHook(() => useMediaListQuery({ limit: 10 }), { wrapper });

    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith('/media', {
        params: { limit: 10, hideWithoutMetadata: true },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('can opt out of the visibility preference', async () => {
    const getSpy = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: { media: [], pagination: {} } } as never);
    useUiStore.getState().setHideMoviesWithoutMetadata(true);

    renderHook(() => useMediaListQuery({ limit: 10 }, { respectVisibilityPreference: false }), {
      wrapper,
    });

    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith('/media', {
        params: { limit: 10 },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

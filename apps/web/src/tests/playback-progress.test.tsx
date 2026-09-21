import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePlaybackProgress } from '../features/player/hooks/usePlaybackProgress';
import { useToastStore } from '../stores/useToastStore';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useUpdateProgressMutation: () => ({ mutateAsync }),
}));

const response = (serverRevision: number, conflict = false) => ({
  progress: { updatedAt: new Date().toISOString(), serverRevision },
  ...(conflict ? { conflict: true } : {}),
});

const makeWrapper = () => {
  const queryClient = new QueryClient();
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const baseOptions = {
  mediaItemId: 'movie-1',
  initialServerRevision: 7,
  isPlaying: false,
  duration: 1_000,
};

describe('video playback progress synchronization', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    sessionStorage.clear();
    useToastStore.getState().clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the fetched canonical revision on the first save', async () => {
    mutateAsync.mockResolvedValue(response(8));
    const { result } = renderHook(() => usePlaybackProgress({ ...baseOptions, currentTime: 100 }), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.saveProgress(true));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      positionSeconds: 100,
      serverRevision: 7,
    });
  });

  it('uses revision zero when no progress row was fetched', async () => {
    mutateAsync.mockResolvedValue(response(1));
    const { result } = renderHook(
      () => usePlaybackProgress({ ...baseOptions, initialServerRevision: 0, currentTime: 100 }),
      { wrapper: makeWrapper() },
    );

    act(() => result.current.saveProgress(true));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ serverRevision: 0 });
  });

  it('does not silently rebase local playback when detail data refreshes elsewhere', async () => {
    mutateAsync.mockResolvedValue(response(8, true));
    const { result, rerender } = renderHook(
      ({ initialServerRevision }) =>
        usePlaybackProgress({ ...baseOptions, initialServerRevision, currentTime: 100 }),
      { initialProps: { initialServerRevision: 7 }, wrapper: makeWrapper() },
    );

    rerender({ initialServerRevision: 8 });
    act(() => result.current.saveProgress());

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ serverRevision: 7 });
  });

  it('resets the revision when switching to another media item', async () => {
    let completeFirst: (result: ReturnType<typeof response>) => void = () => {};
    mutateAsync
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof response>>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(response(4));
    const { result, rerender } = renderHook(
      ({ mediaItemId, initialServerRevision }) =>
        usePlaybackProgress({
          ...baseOptions,
          mediaItemId,
          initialServerRevision,
          currentTime: 100,
        }),
      {
        initialProps: { mediaItemId: 'movie-1', initialServerRevision: 7 },
        wrapper: makeWrapper(),
      },
    );

    act(() => result.current.saveProgress(true));
    rerender({ mediaItemId: 'movie-2', initialServerRevision: 3 });
    act(() => result.current.saveProgress(true));
    await act(async () => completeFirst(response(8)));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      mediaItemId: 'movie-2',
      serverRevision: 3,
    });
  });

  it('serializes an overlapping backward seek behind the earlier save', async () => {
    let completeFirst: (result: ReturnType<typeof response>) => void = () => {};
    mutateAsync
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof response>>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(response(9));
    const { result, rerender } = renderHook(
      ({ currentTime }) => usePlaybackProgress({ ...baseOptions, currentTime }),
      { initialProps: { currentTime: 500 }, wrapper: makeWrapper() },
    );

    act(() => result.current.saveProgress());
    rerender({ currentTime: 40 });
    act(() => result.current.saveProgress(true));
    expect(mutateAsync).toHaveBeenCalledOnce();

    await act(async () => completeFirst(response(8)));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      positionSeconds: 40,
      serverRevision: 8,
    });
  });

  it('does not rebase a stale periodic position over another client', async () => {
    mutateAsync.mockResolvedValue(response(8, true));
    const { result } = renderHook(() => usePlaybackProgress({ ...baseOptions, currentTime: 100 }), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.saveProgress());

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(mutateAsync).toHaveBeenCalledOnce();
  });

  it('rebases a deliberate seek once after a competing update', async () => {
    mutateAsync.mockResolvedValueOnce(response(8, true)).mockResolvedValueOnce(response(9));
    const { result } = renderHook(() => usePlaybackProgress({ ...baseOptions, currentTime: 500 }), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.saveProgress(false, 40));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      positionSeconds: 40,
      serverRevision: 7,
    });
    expect(mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      positionSeconds: 40,
      serverRevision: 8,
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('coalesces rapid scrubbing into the last explicit seek', async () => {
    mutateAsync.mockResolvedValue(response(8));
    const { result } = renderHook(() => usePlaybackProgress({ ...baseOptions, currentTime: 500 }), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.saveProgress(false, 300);
      result.current.saveProgress(false, 100);
      result.current.saveProgress(false, 40);
    });
    expect(mutateAsync).not.toHaveBeenCalled();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ positionSeconds: 40 });
  });

  it('does not queue the pre-seek position when pause arrives before timeupdate', async () => {
    let completeSeek: (result: ReturnType<typeof response>) => void = () => {};
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof response>>((resolve) => {
          completeSeek = resolve;
        }),
    );
    const { result } = renderHook(() => usePlaybackProgress({ ...baseOptions, currentTime: 500 }), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.saveProgress(false, 40));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    act(() => result.current.saveProgress(true));
    await act(async () => completeSeek(response(8)));

    expect(mutateAsync).toHaveBeenCalledOnce();
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ positionSeconds: 40 });
  });

  it('uses the queued seek position for an immediate unload snapshot', () => {
    const keepalive = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', keepalive);
    const { result } = renderHook(() => usePlaybackProgress({ ...baseOptions, currentTime: 500 }), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.saveProgress(false, 40));
    act(() => window.dispatchEvent(new Event('beforeunload')));

    expect(keepalive).toHaveBeenCalledOnce();
    expect(keepalive.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
    expect(JSON.parse(keepalive.mock.calls[0]?.[1].body as string)).toMatchObject({
      positionSeconds: 40,
      serverRevision: 7,
    });
  });
});

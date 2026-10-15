import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMusicSleepTimer, type SleepTimerMinutes } from '../features/music/useMusicSleepTimer';
import { CopyMusicLinkButton } from '../components/music/CopyMusicLinkButton';
import { renderWithProviders } from './helpers/renderWithProviders';
import { useToastStore } from '../stores/useToastStore';
import { t } from '../i18n';

describe('music sleep deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T20:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('expires once at the wall-clock deadline', () => {
    const expire = vi.fn();
    const { result, unmount } = renderHook(() => useMusicSleepTimer('user-1', expire));
    act(() => result.current.setSleepTimer(15));
    act(() => vi.advanceTimersByTime(15 * 60_000 - 1));
    expect(expire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(expire).toHaveBeenCalledOnce();
    expect(result.current.endsAt).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(expire).toHaveBeenCalledOnce();
    unmount();
  });

  it('cancels and replaces the previous deadline without leaving a callback', () => {
    const expire = vi.fn();
    const { result, unmount } = renderHook(() => useMusicSleepTimer('user-1', expire));
    act(() => result.current.setSleepTimer(15));
    act(() => result.current.setSleepTimer(30));
    act(() => vi.advanceTimersByTime(15 * 60_000));
    expect(expire).not.toHaveBeenCalled();
    act(() => result.current.setSleepTimer(null));
    act(() => vi.advanceTimersByTime(60 * 60_000));
    expect(expire).not.toHaveBeenCalled();
    expect(result.current.endsAt).toBeNull();
    unmount();
  });

  it.each(['focus', 'pageshow', 'visibilitychange'])(
    'catches a throttled timer when %s fires',
    (event) => {
      const expire = vi.fn();
      const { result, unmount } = renderHook(() => useMusicSleepTimer('user-1', expire));
      act(() => result.current.setSleepTimer(15));
      // Advance the clock, not callbacks: simulates a suspended background tab.
      vi.setSystemTime(new Date('2026-10-15T20:16:00Z'));
      act(() => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)));
      expect(expire).toHaveBeenCalledOnce();
      expect(result.current.endsAt).toBeNull();
      unmount();
    },
  );

  it('forgets timers across accounts and provider remounts', () => {
    const expire = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ owner }) => useMusicSleepTimer(owner, expire),
      { initialProps: { owner: 'first' as string | null } },
    );
    act(() => result.current.setSleepTimer(15));
    rerender({ owner: 'second' });
    expect(result.current.endsAt).toBeNull();
    rerender({ owner: 'first' });
    expect(result.current.endsAt).toBeNull();
    act(() => vi.advanceTimersByTime(15 * 60_000));
    expect(expire).not.toHaveBeenCalled();
    unmount();
    const fresh = renderHook(() => useMusicSleepTimer('first', expire));
    expect(fresh.result.current.endsAt).toBeNull();
    fresh.unmount();
  });

  it('rejects unsupported timer values and anonymous ownership', () => {
    const expire = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ owner }) => useMusicSleepTimer(owner, expire),
      { initialProps: { owner: null as string | null } },
    );
    act(() => result.current.setSleepTimer(15));
    expect(result.current.endsAt).toBeNull();
    rerender({ owner: 'first' });
    act(() => result.current.setSleepTimer(Number.NaN as SleepTimerMinutes));
    expect(result.current.endsAt).toBeNull();
    unmount();
  });

  it('invalidates callbacks retained by asynchronous work after unmount', () => {
    const expire = vi.fn();
    const { result, unmount } = renderHook(() => useMusicSleepTimer('first', expire));
    act(() => result.current.setSleepTimer(15));
    const lateCheck = result.current.checkExpiry;
    unmount();
    vi.setSystemTime(new Date('2026-10-15T21:00:00Z'));
    expect(lateCheck()).toBe(false);
    expect(expire).not.toHaveBeenCalled();
  });
});

describe('music detail links', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useToastStore.getState().clear();
  });
  it.each(['tracks', 'albums'] as const)(
    'copies a %s page URL without stream query parameters',
    async (kind) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      renderWithProviders(
        <CopyMusicLinkButton kind={kind} id="track-with-query?clientId=private" />,
      );
      fireEvent.click(screen.getByRole('button', { name: t.music.copyMusicLink }));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          `${window.location.origin}/music/${kind}/track-with-query%3FclientId%3Dprivate`,
        ),
      );
      expect(
        useToastStore.getState().toasts.some((item) => item.message === t.music.musicLinkCopied),
      ).toBe(true);
    },
  );
  it('reports clipboard rejection', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    renderWithProviders(<CopyMusicLinkButton kind="tracks" id="fixture" />);
    fireEvent.click(screen.getByRole('button', { name: t.music.copyMusicLink }));
    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((item) => item.message === t.shortcuts.copyFailed),
      ).toBe(true),
    );
  });
});

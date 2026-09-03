import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHlsPlayback } from '../features/player/hooks/useHlsPlayback';

const mock = vi.hoisted(() => ({
  listeners: new Map<
    string,
    (event: string, data: { fatal: boolean; type: string; response?: { code: number } }) => void
  >(),
  startLoad: vi.fn(),
  stopLoad: vi.fn(),
  loadSource: vi.fn(),
  recoverMediaError: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('hls.js', () => ({
  default: class {
    static isSupported = () => true;
    static Events = { MEDIA_ATTACHED: 'attached', ERROR: 'error', FRAG_BUFFERED: 'fragment' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    levels = [{}];
    startLoad = mock.startLoad;
    stopLoad = mock.stopLoad;
    loadSource = mock.loadSource;
    recoverMediaError = mock.recoverMediaError;
    destroy = mock.destroy;
    attachMedia() {}
    on(
      event: string,
      callback: (
        event: string,
        data: { fatal: boolean; type: string; response?: { code: number } },
      ) => void,
    ) {
      mock.listeners.set(event, callback);
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.listeners.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const mount = async () => {
  const video = document.createElement('video');
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  video.currentTime = 42;
  vi.spyOn(video, 'pause').mockImplementation(() => {});
  const onFatalError = vi.fn();
  const onRecovered = vi.fn();
  const options = {
    videoRef: { current: video },
    sourceUrl: '/hls/index.m3u8',
    active: true,
    onUnsupported: vi.fn(),
    onFatalError,
    onRecovered,
  };
  const hook = renderHook((props) => useHlsPlayback(props), { initialProps: options });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return { ...hook, video, onFatalError, onRecovered, options };
};
const fail = (type = 'network') =>
  act(() => {
    mock.listeners.get('error')?.('error', { fatal: true, type });
  });

it('backs off before retrying a fatal network error at the current local position', async () => {
  await mount();
  fail();
  expect(mock.startLoad).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1_000));
  expect(mock.startLoad).toHaveBeenCalledWith(42);
});

it('stops retrying persistent errors and reports one actionable failure', async () => {
  const { onFatalError } = await mount();
  for (const delay of [1_000, 2_000, 4_000]) {
    fail();
    act(() => vi.advanceTimersByTime(delay));
  }
  fail();
  fail();
  act(() => vi.advanceTimersByTime(60_000));
  expect(mock.startLoad).toHaveBeenCalledTimes(3);
  expect(onFatalError).toHaveBeenCalledTimes(1);
});

it('cancels a queued recovery when the source changes or the hook unmounts', async () => {
  const { rerender, unmount, options } = await mount();
  fail();
  rerender({ ...options, sourceUrl: '/hls/another.m3u8' });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  act(() => vi.advanceTimersByTime(1_000));
  expect(mock.startLoad).not.toHaveBeenCalled();
  fail();
  unmount();
  act(() => vi.advanceTimersByTime(60_000));
  expect(mock.startLoad).not.toHaveBeenCalled();
  expect(mock.destroy).toHaveBeenCalledTimes(2);
});

it('does not retry authorization failures and still permits an explicit retry', async () => {
  const { onFatalError, result } = await mount();
  act(() => {
    mock.listeners.get('error')?.('error', {
      fatal: true,
      type: 'network',
      response: { code: 401 },
    });
  });
  act(() => vi.advanceTimersByTime(60_000));
  expect(mock.startLoad).not.toHaveBeenCalled();
  expect(onFatalError).toHaveBeenCalledTimes(1);
  act(() => result.current.retry());
  act(() => vi.advanceTimersByTime(1_000));
  expect(mock.startLoad).toHaveBeenCalledWith(42);
});

it('marks an MSE recovery successful only after a new fragment arrives', async () => {
  const { onRecovered, video } = await mount();
  fail();
  act(() => vi.advanceTimersByTime(1_000));
  video.currentTime = 43;
  video.dispatchEvent(new Event('timeupdate'));
  expect(onRecovered).not.toHaveBeenCalled();
  act(() => mock.listeners.get('fragment')?.('fragment', { fatal: false, type: '' }));
  video.currentTime = 44;
  video.dispatchEvent(new Event('timeupdate'));
  expect(onRecovered).toHaveBeenCalledTimes(1);
});

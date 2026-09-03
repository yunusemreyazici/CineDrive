import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHlsRecovery, HLS_RECOVERY_TIMEOUT_MS } from '../features/player/utils/hlsRecovery';

const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const setup = (playing = true) => {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    paused: { configurable: true, writable: true, value: !playing },
    readyState: { configurable: true, value: 4 },
  });
  video.currentTime = 42;
  const play = vi.spyOn(video, 'play').mockImplementation(async () => {
    Object.defineProperty(video, 'paused', { value: false });
    video.dispatchEvent(new Event('play'));
  });
  vi.spyOn(video, 'pause').mockImplementation(() => {
    Object.defineProperty(video, 'paused', { value: true });
    video.dispatchEvent(new Event('pause'));
  });
  const reload = vi.fn(() => {
    video.pause();
    video.currentTime = 0;
  });
  const onFatalError = vi.fn();
  const onRecovered = vi.fn();
  const stop = vi.fn();
  const recovery = createHlsRecovery({
    video,
    reload,
    stop,
    onFatalError,
    onRecovered,
    onRecovering: vi.fn(),
  });
  cleanups.push(recovery.destroy);
  return { video, play, reload, stop, onFatalError, onRecovered, recovery };
};
it('restores the same local position and playing intent after a native load resets the element', () => {
  const { video, play, recovery } = setup();
  recovery.requestRecovery();
  vi.advanceTimersByTime(1_000);
  expect(video.currentTime).toBe(0);
  expect(recovery.handleLoadedMetadata()).toBe(true);
  expect(video.currentTime).toBe(42);
  expect(play).toHaveBeenCalledTimes(1);
});
it('keeps a previously paused stream paused through recovery', () => {
  const { video, play, recovery, onRecovered } = setup(false);
  recovery.requestRecovery();
  vi.advanceTimersByTime(1_000);
  recovery.handleLoadedMetadata();
  recovery.dataReceived();
  expect(video.currentTime).toBe(42);
  expect(play).not.toHaveBeenCalled();
  expect(onRecovered).toHaveBeenCalledTimes(1);
});
it('honors a user pause while a reload is pending', () => {
  const { play, recovery } = setup();
  recovery.requestRecovery();
  vi.advanceTimersByTime(1_000);
  recovery.setPlaybackIntent(false);
  recovery.handleLoadedMetadata();
  recovery.dataReceived();
  expect(play).not.toHaveBeenCalled();
});
it('does not mistake buffered playback for a restored network', () => {
  const { video, recovery, onRecovered, onFatalError } = setup();
  recovery.requestRecovery();
  video.currentTime = 43;
  video.dispatchEvent(new Event('timeupdate'));
  video.dispatchEvent(new Event('playing'));
  expect(onRecovered).not.toHaveBeenCalled();
  vi.advanceTimersByTime(HLS_RECOVERY_TIMEOUT_MS);
  expect(onFatalError).toHaveBeenCalledTimes(1);
});
it('does not reset the retry budget after a single recovered frame', () => {
  const { video, recovery, onFatalError } = setup();
  for (const delay of [1_000, 2_000, 4_000]) {
    recovery.requestRecovery();
    vi.advanceTimersByTime(delay);
    recovery.dataReceived();
    video.currentTime += 1;
    video.dispatchEvent(new Event('timeupdate'));
  }
  recovery.requestRecovery();
  expect(onFatalError).toHaveBeenCalledTimes(1);
});
it('replenishes the automatic retry budget only after sustained playback', () => {
  const { video, recovery, reload } = setup();
  recovery.requestRecovery();
  vi.advanceTimersByTime(1_000);
  recovery.dataReceived();
  video.currentTime += 1;
  video.dispatchEvent(new Event('timeupdate'));
  for (let second = 0; second < 30; second += 1) {
    vi.advanceTimersByTime(1_000);
    video.currentTime += 1;
    video.dispatchEvent(new Event('timeupdate'));
  }
  recovery.requestRecovery();
  vi.advanceTimersByTime(1_000);
  expect(reload).toHaveBeenCalledTimes(2);
});
it('waits for online without sending requests and retains the overall deadline', () => {
  const { reload, recovery, onFatalError } = setup();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  vi.advanceTimersByTime(10_000);
  expect(reload).not.toHaveBeenCalled();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(1_000);
  expect(reload).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(19_000);
  expect(onFatalError).toHaveBeenCalledTimes(1);
  recovery.dataReceived();
  expect(recovery.handleLoadedMetadata()).toBe(true);
});
it('allows manual retry after exhaustion without losing position or paused intent', () => {
  const { video, play, recovery, reload } = setup(false);
  recovery.requestRecovery();
  vi.advanceTimersByTime(HLS_RECOVERY_TIMEOUT_MS);
  recovery.retry();
  vi.advanceTimersByTime(1_000);
  expect(reload).toHaveBeenLastCalledWith('network', 42);
  recovery.handleLoadedMetadata();
  recovery.dataReceived();
  expect(video.currentTime).toBe(42);
  expect(play).not.toHaveBeenCalled();
});
it('does not postpone stall recovery indefinitely on repeated waiting events', () => {
  const { video, reload } = setup();
  for (let i = 0; i < 12; i++) {
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(1_000);
  }
  vi.advanceTimersByTime(1_000);
  expect(reload).toHaveBeenCalledTimes(1);
});
it('cancels all work and ignores late events after destruction', () => {
  const { recovery, reload, onFatalError } = setup();
  recovery.requestRecovery();
  recovery.destroy();
  recovery.retry();
  recovery.dataReceived();
  window.dispatchEvent(new Event('online'));
  vi.advanceTimersByTime(60_000);
  expect(reload).not.toHaveBeenCalled();
  expect(onFatalError).not.toHaveBeenCalled();
});

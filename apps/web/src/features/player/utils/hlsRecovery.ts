import { getBufferedAheadSeconds } from './playerBrowser';

export const HLS_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const HLS_RECOVERY_TIMEOUT_MS = 30_000;
const STALL_DELAY_MS = 12_000;
const STABLE_PLAYBACK_MS = 30_000;
type Failure = 'network' | 'media';

/** One recovery budget per source, shared by transport, media and stall errors. */
export const createHlsRecovery = ({
  video,
  reload,
  stop,
  onRecovering,
  onRecovered,
  onFatalError,
}: {
  video: HTMLVideoElement;
  reload: (kind: Failure, position: number) => void;
  stop: (terminal: boolean) => void;
  onRecovering: (attempt: number, max: number) => void;
  onRecovered: () => void;
  onFatalError: () => void;
}) => {
  let disposed = false;
  let failed = false;
  let recovering = false;
  let reloading = false;
  let needsRestore = false;
  let receivedData = false;
  let wantsPlayback = !video.paused;
  let position = video.currentTime || 0;
  let lastTime = position;
  let lastAdvanceAt = 0;
  let attempts = 0;
  let kind: Failure = 'network';
  const timers: Record<
    'retry' | 'deadline' | 'stall' | 'stable',
    ReturnType<typeof setTimeout> | null
  > = {
    retry: null,
    deadline: null,
    stall: null,
    stable: null,
  };
  const clear = (name: keyof typeof timers) => {
    if (timers[name] !== null) clearTimeout(timers[name]);
    timers[name] = null;
  };
  const clearAll = () => (Object.keys(timers) as (keyof typeof timers)[]).forEach(clear);
  const scheduleStableReset = () => {
    if (
      attempts === 0 ||
      recovering ||
      failed ||
      disposed ||
      video.paused ||
      timers.stable !== null
    )
      return;
    timers.stable = setTimeout(() => {
      timers.stable = null;
      if (!recovering && !failed && !video.paused && Date.now() - lastAdvanceAt < 1_500) {
        attempts = 0;
      }
    }, STABLE_PLAYBACK_MS);
  };
  const finish = () => {
    if (!recovering || failed || disposed || !receivedData) return;
    recovering = false;
    reloading = false;
    clear('retry');
    clear('deadline');
    onRecovered();
    // A single 'playing' event or buffered frame must not replenish the budget.
    clear('stable');
    scheduleStableReset();
  };
  const fail = () => {
    if (failed || disposed) return;
    if (!recovering && Number.isFinite(video.currentTime)) position = video.currentTime;
    failed = true;
    recovering = false;
    reloading = true;
    clearAll();
    stop(true);
    video.pause();
    onFatalError();
  };
  const schedule = () => {
    if (disposed || failed || timers.retry !== null) return;
    if (attempts >= HLS_RETRY_DELAYS_MS.length) {
      fail();
      return;
    }
    onRecovering(attempts + 1, HLS_RETRY_DELAYS_MS.length);
    timers.retry = setTimeout(() => {
      timers.retry = null;
      // Stay bounded by the deadline, but don't spend attempts while offline.
      if (!navigator.onLine) return;
      attempts += 1;
      reloading = true;
      needsRestore = true;
      receivedData = false;
      reload(kind, position);
    }, HLS_RETRY_DELAYS_MS[attempts]);
  };
  const requestRecovery = (failure: Failure = 'network') => {
    if (disposed || failed) return;
    clear('stall');
    clear('stable');
    kind = failure;
    if (!recovering) {
      recovering = true;
      receivedData = false;
      position = Number.isFinite(video.currentTime) ? video.currentTime : lastTime;
      timers.deadline = setTimeout(fail, HLS_RECOVERY_TIMEOUT_MS);
    }
    stop(false);
    schedule();
  };
  const restore = () => {
    if (!recovering || failed || disposed) return;
    if (needsRestore) {
      try {
        video.currentTime = position;
      } catch {
        return;
      }
      needsRestore = false;
    }
    reloading = false;
    if (wantsPlayback && video.paused) void video.play().catch(() => {});
  };
  const dataReceived = () => {
    if (!recovering || failed || disposed) return;
    receivedData = true;
    restore();
    if (!wantsPlayback && video.readyState >= 3) finish();
  };
  const waiting = () => {
    clear('stable');
    if (
      disposed ||
      failed ||
      recovering ||
      video.paused ||
      getBufferedAheadSeconds(video) >= 1 ||
      timers.stall !== null
    )
      return;
    timers.stall = setTimeout(() => {
      timers.stall = null;
      if (!video.paused && getBufferedAheadSeconds(video) < 1) requestRecovery();
    }, STALL_DELAY_MS);
  };
  const timeupdate = () => {
    const time = video.currentTime;
    if (!video.paused && !video.seeking && time > lastTime + 0.01) {
      lastAdvanceAt = Date.now();
      clear('stall');
      if (!reloading) position = time;
      finish();
      scheduleStableReset();
    }
    lastTime = time;
  };
  const play = () => {
    wantsPlayback = true;
  };
  const pause = () => {
    // load() and native media errors can pause internally. Explicit player
    // controls also call setPlaybackIntent, so user intent always wins.
    if (!reloading && !video.error) wantsPlayback = false;
    clear('stall');
    clear('stable');
  };
  const offline = () => {
    if (wantsPlayback || recovering) requestRecovery();
  };
  const online = () => {
    if (recovering && !failed) schedule();
  };
  video.addEventListener('play', play);
  video.addEventListener('pause', pause);
  video.addEventListener('timeupdate', timeupdate);
  video.addEventListener('waiting', waiting);
  video.addEventListener('stalled', waiting);
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);

  return {
    requestRecovery,
    dataReceived,
    fail,
    setPlaybackIntent(value: boolean) {
      wantsPlayback = value;
    },
    getRecoveryPosition() {
      return recovering || failed || reloading ? position : null;
    },
    handleLoadedMetadata() {
      if (!recovering && !failed) return false;
      restore();
      return true;
    },
    retry() {
      if (disposed) return;
      clearAll();
      failed = false;
      recovering = true;
      attempts = 0;
      timers.deadline = setTimeout(fail, HLS_RECOVERY_TIMEOUT_MS);
      schedule();
    },
    destroy() {
      disposed = true;
      clearAll();
      video.removeEventListener('play', play);
      video.removeEventListener('pause', pause);
      video.removeEventListener('timeupdate', timeupdate);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('stalled', waiting);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    },
  };
};

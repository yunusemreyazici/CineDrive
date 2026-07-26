import { useState, useEffect, useCallback, useRef } from 'react';

const CONTROLS_HIDE_DELAY_MS = 3500;

export function usePlayerControls(isPlaying: boolean) {
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  };

  /** Called from pointer activity — reveals the controls and restarts the fade. */
  const resetHideTimer = useCallback(() => {
    setAreControlsVisible(true);
    clearHideTimer();

    if (!isPlaying) return;
    hideTimerRef.current = setTimeout(
      () => setAreControlsVisible(false),
      CONTROLS_HIDE_DELAY_MS,
    );
  }, [isPlaying]);

  // Starting playback begins the fade. The controls are already visible at that
  // point — the user just interacted — so this only schedules the hide rather
  // than setting state synchronously during the effect.
  useEffect(() => {
    clearHideTimer();
    if (!isPlaying) return;

    hideTimerRef.current = setTimeout(
      () => setAreControlsVisible(false),
      CONTROLS_HIDE_DELAY_MS,
    );
    return clearHideTimer;
  }, [isPlaying]);

  return {
    areControlsVisible,
    resetHideTimer,
    showControls: () => setAreControlsVisible(true),
  };
}

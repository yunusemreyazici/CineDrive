import { useState, useEffect, useCallback, useRef } from 'react';

export function usePlayerControls(isPlaying: boolean) {
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetHideTimer = useCallback(() => {
    setAreControlsVisible(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => {
        setAreControlsVisible(false);
      }, 3500);
    }
  }, [isPlaying]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isPlaying, resetHideTimer]);

  return {
    areControlsVisible,
    resetHideTimer,
    showControls: () => setAreControlsVisible(true),
  };
}

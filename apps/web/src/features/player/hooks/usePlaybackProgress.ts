import { useRef, useEffect, useCallback } from 'react';
import { useUpdateProgressMutation } from '../../../hooks/useApi';

interface UsePlaybackProgressOptions {
  mediaItemId: string;
  episodeId?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export function usePlaybackProgress({
  mediaItemId,
  episodeId,
  isPlaying,
  currentTime,
  duration,
}: UsePlaybackProgressOptions) {
  const updateProgressMutation = useUpdateProgressMutation();
  const lastSavedPositionRef = useRef<number>(-1);
  const lastSavedTimeRef = useRef<number>(0);

  const saveProgress = useCallback(
    (force = false) => {
      if (!mediaItemId || duration <= 0) return;

      const pos = Math.floor(currentTime);
      const dur = Math.floor(duration);

      // Avoid redundant progress updates if position hasn't meaningfully changed
      if (!force && Math.abs(pos - lastSavedPositionRef.current) < 2) {
        return;
      }

      lastSavedPositionRef.current = pos;
      lastSavedTimeRef.current = Date.now();

      updateProgressMutation.mutate({
        mediaItemId,
        episodeId: episodeId || undefined,
        positionSeconds: pos,
        durationSeconds: dur,
      });
    },
    [mediaItemId, episodeId, currentTime, duration, updateProgressMutation],
  );

  // Periodic progress saving every 15 seconds during active playback
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      saveProgress();
    }, 15000);

    return () => clearInterval(interval);
  }, [isPlaying, saveProgress]);

  // Save progress when user pauses
  useEffect(() => {
    if (!isPlaying && currentTime > 0) {
      saveProgress(true);
    }
  }, [isPlaying, saveProgress, currentTime]);

  // Save progress on page unload (tab close / refresh) with fetch keepalive
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (mediaItemId && duration > 0 && lastSavedPositionRef.current > 0) {
        const pos = Math.floor(lastSavedPositionRef.current);
        const dur = Math.floor(duration);
        const payload = JSON.stringify({
          mediaItemId,
          episodeId: episodeId || undefined,
          positionSeconds: pos,
          durationSeconds: dur,
        });

        fetch('/api/playback/progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
          credentials: 'include',
        }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [mediaItemId, episodeId, duration]);

  // Save progress when component unmounts
  useEffect(() => {
    return () => {
      if (lastSavedPositionRef.current > 0) {
        saveProgress(true);
      }
    };
  }, [saveProgress]);

  return { saveProgress };
}

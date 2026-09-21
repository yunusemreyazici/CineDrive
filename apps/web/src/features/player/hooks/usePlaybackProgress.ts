import { useRef, useEffect, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProgressMutation } from '../../../hooks/useApi';

const PLAYBACK_CLIENT_KEY = 'cinedrive_video_playback_client';
const PLAYBACK_SEQUENCE_KEY = 'cinedrive_video_playback_sequence';
let fallbackSequence = 0;

const makePlaybackClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const getPlaybackClientId = (): string => {
  try {
    const stored = globalThis.sessionStorage?.getItem(PLAYBACK_CLIENT_KEY);
    if (stored) return stored;
    const created = makePlaybackClientId();
    globalThis.sessionStorage?.setItem(PLAYBACK_CLIENT_KEY, created);
    return created;
  } catch {
    return makePlaybackClientId();
  }
};

const nextPlaybackSequence = (): number => {
  try {
    const stored = Number(globalThis.sessionStorage?.getItem(PLAYBACK_SEQUENCE_KEY) || 0);
    const next = Math.max(Number.isSafeInteger(stored) ? stored + 1 : 1, fallbackSequence + 1);
    fallbackSequence = next;
    globalThis.sessionStorage?.setItem(PLAYBACK_SEQUENCE_KEY, String(next));
    return next;
  } catch {
    fallbackSequence += 1;
    return fallbackSequence;
  }
};

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
  const queryClient = useQueryClient();
  const { mutate } = useUpdateProgressMutation({ invalidateOnSuccess: false });

  const optionsRef = useRef({ mediaItemId, episodeId, currentTime, duration, mutate });
  const latestPositionRef = useRef({ currentTime, duration });
  useEffect(() => {
    optionsRef.current = { mediaItemId, episodeId, currentTime, duration, mutate };
    latestPositionRef.current = { currentTime, duration };
  });

  const lastSavedPositionRef = useRef<number>(-1);
  const prevIsPlayingRef = useRef<boolean>(isPlaying);
  const [clientInstanceId] = useState(getPlaybackClientId);
  const serverRevisionRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // A new media/episode gets its own change threshold and unload snapshot.
    // Otherwise the first position of the next item can be suppressed because
    // it is close to the previous item's last saved second.
    lastSavedPositionRef.current = -1;
    serverRevisionRef.current = undefined;
  }, [mediaItemId, episodeId]);

  const saveProgress = useCallback(
    (force = false) => {
      const { mediaItemId, episodeId, duration, mutate } = optionsRef.current;
      if (!mediaItemId || duration <= 0) return;

      const latest = latestPositionRef.current;
      const pos = Math.floor(latest.currentTime);
      const dur = Math.floor(latest.duration || duration);

      // Avoid redundant progress updates if position hasn't meaningfully changed
      if (!force && Math.abs(pos - lastSavedPositionRef.current) < 2) {
        return;
      }

      lastSavedPositionRef.current = pos;
      const clientSequence = nextPlaybackSequence();

      mutate(
        {
          mediaItemId,
          episodeId: episodeId || undefined,
          positionSeconds: pos,
          durationSeconds: dur,
          clientInstanceId,
          clientSequence,
          serverRevision: serverRevisionRef.current,
          clientTimestamp: Date.now(),
        },
        {
          onSuccess: (result) => {
            const revision = result.progress?.serverRevision;
            if (Number.isSafeInteger(revision)) {
              serverRevisionRef.current = Math.max(serverRevisionRef.current || 0, revision);
            }
            if (!force) return;
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: ['continueWatching'] }),
              queryClient.invalidateQueries({ queryKey: ['watchHistory'] }),
            ]);
          },
        },
      );
    },
    [clientInstanceId, queryClient],
  );

  // Periodic progress saving every 15 seconds during active playback
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      saveProgress();
    }, 15000);

    return () => clearInterval(interval);
  }, [isPlaying, saveProgress]);

  // Save progress ONCE when user pauses (transition from playing -> paused)
  useEffect(() => {
    if (prevIsPlayingRef.current && !isPlaying && optionsRef.current.currentTime > 0) {
      saveProgress(true);
    }
    prevIsPlayingRef.current = isPlaying;
  }, [isPlaying, saveProgress]);

  // Save progress on page unload (tab close / refresh) with fetch keepalive
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { mediaItemId, episodeId } = optionsRef.current;
      const { currentTime, duration } = latestPositionRef.current;
      if (mediaItemId && duration > 0 && currentTime > 0) {
        const pos = Math.floor(currentTime);
        const dur = Math.floor(duration);
        const payload = JSON.stringify({
          mediaItemId,
          episodeId: episodeId || undefined,
          positionSeconds: pos,
          durationSeconds: dur,
          clientInstanceId,
          clientSequence: nextPlaybackSequence(),
          serverRevision: serverRevisionRef.current,
          clientTimestamp: Date.now(),
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
  }, [clientInstanceId]);

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

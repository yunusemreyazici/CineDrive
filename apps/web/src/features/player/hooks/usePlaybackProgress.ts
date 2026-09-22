import { useRef, useEffect, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProgressMutation } from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { t } from '../../../i18n';

const PLAYBACK_CLIENT_KEY = 'cinedrive_video_playback_client';
const PLAYBACK_SEQUENCE_KEY = 'cinedrive_video_playback_sequence';
const SEEK_SAVE_DEBOUNCE_MS = 350;
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
  initialServerRevision: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

interface PendingProgress {
  mediaKey: string;
  mediaItemId: string;
  episodeId?: string;
  positionSeconds: number;
  durationSeconds: number;
  clientSequence: number;
  force: boolean;
  explicitSeek: boolean;
}

export function usePlaybackProgress({
  mediaItemId,
  episodeId,
  initialServerRevision,
  isPlaying,
  currentTime,
  duration,
}: UsePlaybackProgressOptions) {
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateProgressMutation({ invalidateOnSuccess: false });
  const mediaKey = JSON.stringify([mediaItemId, episodeId || null]);

  const optionsRef = useRef({ mediaItemId, episodeId, currentTime, duration, mutateAsync });
  const latestPositionRef = useRef({ currentTime, duration });
  const seekPositionRef = useRef<number | null>(null);
  useEffect(() => {
    optionsRef.current = { mediaItemId, episodeId, currentTime, duration, mutateAsync };
    latestPositionRef.current = { currentTime, duration };
    if (seekPositionRef.current !== null && Math.abs(currentTime - seekPositionRef.current) <= 2) {
      seekPositionRef.current = null;
    }
  });

  const lastSavedPositionRef = useRef<number>(-1);
  const prevIsPlayingRef = useRef<boolean>(isPlaying);
  const [clientInstanceId] = useState(getPlaybackClientId);
  const serverRevisionRef = useRef(initialServerRevision);
  const mediaKeyRef = useRef(mediaKey);
  const pendingRef = useRef<PendingProgress | null>(null);
  const activeRequestRef = useRef<PendingProgress | null>(null);
  const inFlightRef = useRef(false);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextPending = () => pendingRef.current;

  useEffect(() => {
    // A new media/episode gets its own change threshold and unload snapshot.
    // Otherwise the first position of the next item can be suppressed because
    // it is close to the previous item's last saved second.
    if (mediaKeyRef.current !== mediaKey) {
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
      mediaKeyRef.current = mediaKey;
      pendingRef.current = null;
      seekPositionRef.current = null;
      lastSavedPositionRef.current = -1;
      serverRevisionRef.current = initialServerRevision;
    }
  }, [mediaKey, initialServerRevision]);

  const flushPending = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      while (pendingRef.current) {
        if (pendingRef.current.explicitSeek && seekTimerRef.current) break;
        const request = pendingRef.current;
        pendingRef.current = null;
        activeRequestRef.current = request;
        const send = (serverRevision: number) =>
          optionsRef.current.mutateAsync({
            mediaItemId: request.mediaItemId,
            episodeId: request.episodeId,
            positionSeconds: request.positionSeconds,
            durationSeconds: request.durationSeconds,
            clientInstanceId,
            clientSequence: request.clientSequence,
            serverRevision,
            clientTimestamp: Date.now(),
          });

        try {
          let result = await send(serverRevisionRef.current);
          if (mediaKeyRef.current !== request.mediaKey) continue;
          serverRevisionRef.current = result.progress.serverRevision;

          // A seek is a new, explicit user action. Rebase it once after a
          // conflict; never rebase an old periodic/pause snapshot over another
          // device's newer state. A queued newer seek supersedes this one.
          if (result.conflict && request.explicitSeek && !nextPending()?.explicitSeek) {
            result = await send(serverRevisionRef.current);
            if (mediaKeyRef.current !== request.mediaKey) continue;
            serverRevisionRef.current = result.progress.serverRevision;
          }

          if (result.conflict) {
            if (nextPending()?.explicitSeek) continue;
            pendingRef.current = null;
            seekPositionRef.current = null;
            lastSavedPositionRef.current = -1;
            toast.info(t.player.progressConflict);
            continue;
          }

          if (request.force) {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: ['continueWatching'] }),
              queryClient.invalidateQueries({ queryKey: ['watchHistory'] }),
            ]);
          }
        } catch (error) {
          if (mediaKeyRef.current !== request.mediaKey) continue;
          lastSavedPositionRef.current = -1;
          if (request.force) toast.fromError(error);
        } finally {
          activeRequestRef.current = null;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [clientInstanceId, queryClient]);

  const saveProgress = useCallback(
    (force = false, seekPositionSeconds?: number) => {
      const { mediaItemId, episodeId, duration } = optionsRef.current;
      if (!mediaItemId || duration <= 0) return;

      const latest = latestPositionRef.current;
      const explicitSeek = seekPositionSeconds !== undefined;
      const pos = Math.floor(seekPositionSeconds ?? seekPositionRef.current ?? latest.currentTime);
      const dur = Math.floor(latest.duration || duration);

      // Avoid redundant progress updates if position hasn't meaningfully changed
      if (!force && !explicitSeek && Math.abs(pos - lastSavedPositionRef.current) < 2) {
        return;
      }

      if (explicitSeek) seekPositionRef.current = pos;
      if (
        !explicitSeek &&
        pos === lastSavedPositionRef.current &&
        (pendingRef.current?.explicitSeek || activeRequestRef.current?.explicitSeek)
      ) {
        return;
      }

      // Keep an unsent explicit seek ahead of lifecycle/periodic snapshots.
      // A newer explicit seek replaces it, which also coalesces scrubbing.
      if (pendingRef.current?.explicitSeek && !explicitSeek) return;
      lastSavedPositionRef.current = pos;
      pendingRef.current = {
        mediaKey: mediaKeyRef.current,
        mediaItemId,
        episodeId: episodeId || undefined,
        positionSeconds: pos,
        durationSeconds: dur,
        clientSequence: nextPlaybackSequence(),
        force,
        explicitSeek,
      };
      if (explicitSeek) {
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        seekTimerRef.current = setTimeout(() => {
          seekTimerRef.current = null;
          void flushPending();
        }, SEEK_SAVE_DEBOUNCE_MS);
      } else {
        void flushPending();
      }
    },
    [flushPending],
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
      const position = pendingRef.current?.explicitSeek
        ? pendingRef.current.positionSeconds
        : (seekPositionRef.current ?? currentTime);
      if (mediaItemId && duration > 0 && (position > 0 || lastSavedPositionRef.current >= 0)) {
        const pos = Math.floor(position);
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
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
      if (lastSavedPositionRef.current > 0) {
        saveProgress(true);
      }
      void flushPending();
    };
  }, [saveProgress, flushPending]);

  return { saveProgress };
}

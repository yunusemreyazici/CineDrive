import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MusicTrackDto } from '@cinedrive/shared';
import { ApiRequestError, apiClient } from '../../api/client';
import { fetchMusicPlaybackState, saveMusicPlaybackState } from '../../hooks/useMusicApi';

export interface MusicQueueEntry {
  id: string;
  trackId: string;
  sourceOrder: number;
  playOrder: number;
  track: MusicTrackDto;
}

interface MusicPlayerContextValue {
  queue: MusicQueueEntry[];
  currentTrack: MusicTrackDto | null;
  currentQueueItemId: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffleEnabled: boolean;
  repeatMode: 'off' | 'all' | 'one';
  playTracks: (tracks: MusicTrackDto[], startIndex?: number) => void;
  playQueueItem: (id: string) => void;
  addToQueue: (track: MusicTrackDto) => void;
  playNext: (track: MusicTrackDto) => void;
  removeFromQueue: (id: string) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);
const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export const MusicPlayerProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const revisionRef = useRef(0);
  const historyRecordedRef = useRef(new Set<string>());
  const pendingPlayRef = useRef(false);
  const restoredPositionRef = useRef(0);
  const [queue, setQueue] = useState<MusicQueueEntry[]>([]);
  const [currentQueueItemId, setCurrentQueueItemId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const [transcode, setTranscode] = useState(false);
  const [transcodeStart, setTranscodeStart] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    try {
      const raw = globalThis.localStorage?.getItem('cinedrive_music_volume');
      if (raw === null || raw === undefined) return 0.8;
      const saved = Number(raw);
      return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.8;
    } catch {
      return 0.8;
    }
  });

  const orderedQueue = useMemo(() => [...queue].sort((a, b) => a.playOrder - b.playOrder), [queue]);
  const currentEntry = queue.find((item) => item.id === currentQueueItemId) || null;
  const currentTrack = currentEntry?.track || null;
  const currentTrackId = currentTrack?.id || null;

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    let active = true;
    void fetchMusicPlaybackState()
      .then((state) => {
        if (!active) return;
        revisionRef.current = state.revision;
        setQueue(state.queue);
        setCurrentQueueItemId(
          state.currentQueueItemId ||
            state.queue.find((item) => item.trackId === state.currentTrackId)?.id ||
            null,
        );
        restoredPositionRef.current = state.positionSeconds;
        setPosition(state.positionSeconds);
        setShuffleEnabled(state.shuffleEnabled);
        setRepeatMode(state.repeatMode);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const snapshot = useCallback(
    () => ({
      revision: revisionRef.current,
      currentTrackId: currentTrack?.id || null,
      currentQueueItemId,
      positionSeconds: audioRef.current
        ? audioRef.current.currentTime + (transcode ? transcodeStart : 0)
        : position,
      shuffleEnabled,
      repeatMode,
      queue: queue.map(({ id, trackId, sourceOrder, playOrder }) => ({
        id,
        trackId,
        sourceOrder,
        playOrder,
      })),
      updatedAt: new Date().toISOString(),
    }),
    [
      currentQueueItemId,
      currentTrack?.id,
      position,
      queue,
      repeatMode,
      shuffleEnabled,
      transcode,
      transcodeStart,
    ],
  );

  const sync = useCallback(async () => {
    const state = snapshot();
    try {
      const result = await saveMusicPlaybackState(state);
      revisionRef.current = result.revision;
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 409) return;
      try {
        const remote = await fetchMusicPlaybackState();
        revisionRef.current = remote.revision;
        const result = await saveMusicPlaybackState({ ...state, revision: remote.revision });
        revisionRef.current = result.revision;
      } catch {
        // The next periodic sync retries without interrupting playback.
      }
    }
  }, [snapshot]);

  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  const playbackStateKey = useMemo(
    () =>
      JSON.stringify({
        currentTrackId,
        currentQueueItemId,
        shuffleEnabled,
        repeatMode,
        queue: queue.map(({ id, sourceOrder, playOrder }) => ({ id, sourceOrder, playOrder })),
      }),
    [currentQueueItemId, currentTrackId, queue, repeatMode, shuffleEnabled],
  );
  useEffect(() => {
    if (!currentTrackId) return;
    const timer = window.setTimeout(() => void syncRef.current(), 250);
    return () => window.clearTimeout(timer);
  }, [currentTrackId, playbackStateKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (currentTrackId) void sync();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [currentTrackId, sync]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackId) return;
    audio.load();
    const start = restoredPositionRef.current;
    restoredPositionRef.current = 0;
    const onMetadata = () => {
      if (!transcode && start > 0 && start < audio.duration) audio.currentTime = start;
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        void audio.play().catch(() => setIsPlaying(false));
      }
    };
    audio.addEventListener('loadedmetadata', onMetadata, { once: true });
    return () => audio.removeEventListener('loadedmetadata', onMetadata);
  }, [currentTrackId, transcode, transcodeStart]);

  const selectEntry = useCallback((entry: MusicQueueEntry, autoPlay = true) => {
    setCurrentQueueItemId(entry.id);
    setPosition(0);
    restoredPositionRef.current = 0;
    setTranscode(false);
    setTranscodeStart(0);
    pendingPlayRef.current = autoPlay;
    historyRecordedRef.current.delete(entry.id);
  }, []);

  const next = useCallback(() => {
    if (!currentQueueItemId) return;
    const index = orderedQueue.findIndex((item) => item.id === currentQueueItemId);
    const candidate =
      orderedQueue[index + 1] || (repeatMode === 'all' ? orderedQueue[0] : undefined);
    if (candidate) selectEntry(candidate);
    else {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  }, [currentQueueItemId, orderedQueue, repeatMode, selectEntry]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 5) {
      audio.currentTime = 0;
      return;
    }
    const index = orderedQueue.findIndex((item) => item.id === currentQueueItemId);
    const candidate =
      orderedQueue[index - 1] || (repeatMode === 'all' ? orderedQueue.at(-1) : undefined);
    if (candidate) selectEntry(candidate);
  }, [currentQueueItemId, orderedQueue, repeatMode, selectEntry]);

  const playTracks = useCallback(
    (tracks: MusicTrackDto[], startIndex = 0) => {
      const entries = tracks.map((track, index) => ({
        id: makeId(),
        trackId: track.id,
        sourceOrder: index,
        playOrder: index,
        track,
      }));
      setQueue(entries);
      const first = entries[Math.max(0, Math.min(startIndex, entries.length - 1))];
      if (first) selectEntry(first);
    },
    [selectEntry],
  );

  const addToQueue = useCallback((track: MusicTrackDto) => {
    setQueue((items) => [
      ...items,
      {
        id: makeId(),
        trackId: track.id,
        sourceOrder: items.length,
        playOrder: items.length,
        track,
      },
    ]);
  }, []);

  const playNext = useCallback(
    (track: MusicTrackDto) => {
      setQueue((items) => {
        const currentOrder = items.find((item) => item.id === currentQueueItemId)?.playOrder ?? -1;
        return [
          ...items.map((item) =>
            item.playOrder > currentOrder ? { ...item, playOrder: item.playOrder + 1 } : item,
          ),
          {
            id: makeId(),
            trackId: track.id,
            sourceOrder: items.length,
            playOrder: currentOrder + 1,
            track,
          },
        ];
      });
    },
    [currentQueueItemId],
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      setQueue((items) =>
        items
          .filter((item) => item.id !== id)
          .map((item, index) => ({ ...item, playOrder: index })),
      );
      if (id === currentQueueItemId) next();
    },
    [currentQueueItemId, next],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);
  const seek = useCallback(
    (seconds: number) => {
      if (transcode) {
        pendingPlayRef.current = isPlaying;
        setTranscodeStart(seconds);
      } else if (audioRef.current) {
        audioRef.current.currentTime = seconds;
      }
      setPosition(seconds);
      void sync();
    },
    [isPlaying, sync, transcode],
  );
  const setVolume = useCallback((nextVolume: number) => {
    const value = Math.min(1, Math.max(0, nextVolume));
    setVolumeState(value);
    try {
      globalThis.localStorage?.setItem('cinedrive_music_volume', String(value));
    } catch {
      /* Keep the in-memory volume. */
    }
    if (audioRef.current) audioRef.current.volume = value;
  }, []);

  const toggleShuffle = useCallback(() => {
    setQueue((items) => {
      if (shuffleEnabled) return items.map((item) => ({ ...item, playOrder: item.sourceOrder }));
      const current = items.find((item) => item.id === currentQueueItemId);
      const rest = items
        .filter((item) => item.id !== currentQueueItemId)
        .sort(() => Math.random() - 0.5);
      return [...(current ? [current] : []), ...rest].map((item, index) => ({
        ...item,
        playOrder: index,
      }));
    });
    setShuffleEnabled((value) => !value);
  }, [currentQueueItemId, shuffleEnabled]);
  const cycleRepeat = useCallback(
    () => setRepeatMode((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')),
    [],
  );

  const value = useMemo<MusicPlayerContextValue>(
    () => ({
      queue: orderedQueue,
      currentTrack,
      currentQueueItemId,
      isPlaying,
      position,
      duration,
      volume,
      shuffleEnabled,
      repeatMode,
      playTracks,
      playQueueItem: (id) => {
        const entry = queue.find((item) => item.id === id);
        if (entry) selectEntry(entry);
      },
      addToQueue,
      playNext,
      removeFromQueue,
      togglePlay,
      next,
      previous,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
    }),
    [
      addToQueue,
      currentQueueItemId,
      currentTrack,
      cycleRepeat,
      duration,
      isPlaying,
      next,
      orderedQueue,
      playNext,
      playTracks,
      position,
      previous,
      queue,
      removeFromQueue,
      repeatMode,
      seek,
      selectEntry,
      setVolume,
      shuffleEnabled,
      togglePlay,
      toggleShuffle,
      volume,
    ],
  );

  const source = currentTrack
    ? `${currentTrack.streamUrl}${transcode ? `?transcode=1&start=${Math.floor(transcodeStart)}` : ''}`
    : undefined;
  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- music tracks do not have caption tracks */}
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          void sync();
        }}
        onDurationChange={(event) =>
          setDuration(
            transcode
              ? currentTrack?.duration || 0
              : Number.isFinite(event.currentTarget.duration)
                ? event.currentTarget.duration
                : currentTrack?.duration || 0,
          )
        }
        onTimeUpdate={(event) => {
          const seconds = event.currentTarget.currentTime + (transcode ? transcodeStart : 0);
          setPosition(seconds);
          if (
            currentEntry &&
            !historyRecordedRef.current.has(currentEntry.id) &&
            seconds >= Math.min(30, event.currentTarget.duration || 30)
          ) {
            historyRecordedRef.current.add(currentEntry.id);
            void apiClient.post('/music/history', {
              trackId: currentEntry.trackId,
              listenedSeconds: seconds,
            });
          }
        }}
        onEnded={() => {
          if (repeatMode === 'one' && audioRef.current) {
            audioRef.current.currentTime = 0;
            void audioRef.current.play();
          } else next();
        }}
        onError={() => {
          if (currentTrack && !transcode) {
            restoredPositionRef.current = 0;
            pendingPlayRef.current = isPlaying;
            setTranscodeStart(position);
            setTranscode(true);
          } else setIsPlaying(false);
        }}
        className="hidden"
      />
    </MusicPlayerContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- provider and hook intentionally share one context module
export const useMusicPlayer = () => {
  const context = useContext(MusicPlayerContext);
  if (!context) throw new Error('useMusicPlayer must be used inside MusicPlayerProvider');
  return context;
};

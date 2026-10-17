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
import { useQueryClient } from '@tanstack/react-query';
import { useSessionQuery } from '../../hooks/useApi';
import { useMusicSleepTimer, type SleepTimerMinutes } from './useMusicSleepTimer';
import { toast } from '../../stores/useToastStore';
import { t } from '../../i18n';
import { MusicListeningSession, type MusicListeningEvent } from './musicListeningHistory';
import {
  fetchMusicPlaybackState,
  fetchTrackRadio,
  saveMusicPlaybackState,
} from '../../hooks/useMusicApi';
import {
  DEFAULT_MUSIC_AUDIO_SETTINGS,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  logicalMusicPosition,
  parseStoredAudioSettings,
  replayGainLinear,
  requiresMusicTranscode,
  type EqPreset,
  type MusicAudioSettings,
} from './musicAudio';
import {
  appendUniqueMusicQueueEntries,
  appendMusicQueueEntry,
  insertNextMusicQueueEntry,
  remainingMusicQueueEntries,
  removeMusicQueueEntry,
  shuffleMusicQueueEntries,
  type MusicQueueEntry,
} from './musicQueue';

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
  continuousPlayEnabled: boolean;
  audioSettings: MusicAudioSettings;
  playTracks: (tracks: MusicTrackDto[], startIndex?: number, position?: number) => void;
  playShuffledTracks: (tracks: MusicTrackDto[]) => void;
  playQueueItem: (id: string) => void;
  addToQueue: (track: MusicTrackDto) => void;
  playNext: (track: MusicTrackDto) => void;
  removeFromQueue: (id: string) => void;
  removedQueueTitle: string | null;
  undoQueueRemoval: () => void;
  togglePlay: () => void;
  pause: () => void;
  sleepTimerEndsAt: number | null;
  setSleepTimer: (minutes: SleepTimerMinutes | null) => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleContinuousPlay: () => void;
  updateAudioSettings: (settings: Partial<MusicAudioSettings>) => void;
  setEqPreset: (preset: Exclude<EqPreset, 'custom'>) => void;
  setEqBand: (index: number, gain: number) => void;
}

interface AudioGraph {
  context: AudioContext;
  slotGains: [GainNode, GainNode];
  filters: BiquadFilterNode[];
  compressor: DynamicsCompressorNode;
  masterGain: GainNode;
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);
const AUDIO_SETTINGS_KEY = 'cinedrive_music_audio_settings';
const CONTINUOUS_PLAY_KEY = 'cinedrive_music_continuous_play';
const PLAYBACK_CLIENT_KEY = 'cinedrive_music_playback_client';
const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
const makeHistoryId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const value = Math.floor(Math.random() * 16);
        return (character === 'x' ? value : (value & 3) | 8).toString(16);
      });

const sourceForTrack = (track: MusicTrackDto, clientId: string, transcode = false, start = 0) => {
  const params = new URLSearchParams({ clientId });
  if (transcode) {
    params.set('transcode', '1');
    params.set('start', String(Math.floor(start)));
  }
  return `${track.streamUrl}${track.streamUrl.includes('?') ? '&' : '?'}${params}`;
};

const playbackClientIdentity = () => {
  let clientId: string | null = null;
  try {
    clientId = globalThis.sessionStorage?.getItem(PLAYBACK_CLIENT_KEY) || null;
    if (!clientId) {
      clientId = makeId();
      globalThis.sessionStorage?.setItem(PLAYBACK_CLIENT_KEY, clientId);
    }
  } catch {
    clientId = makeId();
  }
  return {
    clientId: clientId || makeId(),
    clientName:
      typeof navigator === 'undefined' ? 'Web player' : `Web · ${navigator.platform || 'Browser'}`,
    platform: 'web' as const,
  };
};

export const MusicPlayerProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { data: session } = useSessionQuery();
  const queryClient = useQueryClient();
  const historyOwner = session?.authenticated ? (session.user?.id ?? null) : null;
  const historyOwnerRef = useRef(historyOwner);
  const historyGenerationRef = useRef(0);
  const listeningSessionsRef = useRef(new Map<string, MusicListeningSession>());
  const pendingHistoryRef = useRef(new Map<string, MusicListeningEvent>());
  const historyUploadRef = useRef(false);
  const audioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const slotEntryIdsRef = useRef<[string | null, string | null]>([null, null]);
  const activeSlotRef = useRef<0 | 1>(0);
  const graphRef = useRef<AudioGraph | null>(null);
  const queueRef = useRef<MusicQueueEntry[]>([]);
  const currentQueueItemIdRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncConflictRef = useRef(false);
  const queueGenerationRef = useRef(0);
  const radioExtensionInFlightRef = useRef<Promise<MusicQueueEntry | null> | null>(null);
  const pendingPlayRef = useRef(false);
  const playbackIntentGenerationRef = useRef(0);
  const explicitlyPausedRef = useRef(false);
  const restoredPositionRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);
  const [queue, setQueue] = useState<MusicQueueEntry[]>([]);
  const [queueRemoval, setQueueRemoval] = useState<{
    before: MusicQueueEntry[];
    after: MusicQueueEntry[];
    title: string;
    owner: string | null;
  } | null>(null);
  const [currentQueueItemId, setCurrentQueueItemId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const [continuousPlayEnabled, setContinuousPlayEnabled] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(CONTINUOUS_PLAY_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [transcode, setTranscode] = useState(false);
  const [transcodeStart, setTranscodeStart] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [audioSettings, setAudioSettings] = useState<MusicAudioSettings>(() => {
    try {
      return parseStoredAudioSettings(globalThis.localStorage?.getItem(AUDIO_SETTINGS_KEY) || null);
    } catch {
      return DEFAULT_MUSIC_AUDIO_SETTINGS;
    }
  });
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
  const playbackClient = useMemo(() => playbackClientIdentity(), []);

  const orderedQueue = useMemo(() => [...queue].sort((a, b) => a.playOrder - b.playOrder), [queue]);
  const currentEntry = queue.find((item) => item.id === currentQueueItemId) || null;
  const currentTrack = currentEntry?.track || null;
  const currentTrackId = currentTrack?.id || null;

  // Any subsequent queue edit invalidates undo, so restoring cannot discard new entries.
  if (queueRemoval && (queue !== queueRemoval.after || historyOwner !== queueRemoval.owner)) {
    setQueueRemoval(null);
  }

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    currentQueueItemIdRef.current = currentQueueItemId;
  }, [currentQueueItemId]);

  const entryForSlot = useCallback((slot: 0 | 1) => {
    const id = slotEntryIdsRef.current[slot];
    return queueRef.current.find((entry) => entry.id === id) || null;
  }, []);

  const uploadHistory = useCallback(() => {
    const owner = historyOwnerRef.current;
    const generation = historyGenerationRef.current;
    const currentSession = queryClient.getQueryData<{
      authenticated: boolean;
      user?: { id: string };
    }>(['session']);
    if (
      !owner ||
      !currentSession?.authenticated ||
      currentSession.user?.id !== owner ||
      historyUploadRef.current ||
      pendingHistoryRef.current.size === 0
    )
      return;
    const events = [...pendingHistoryRef.current.values()].slice(0, 100);
    historyUploadRef.current = true;
    void apiClient
      .post<{ acceptedEventIds: string[]; rejectedEventIds: string[] }>('/music/history/batch', {
        events,
      })
      .then(({ data }) => {
        if (historyOwnerRef.current !== owner || historyGenerationRef.current !== generation)
          return;
        for (const id of [...data.acceptedEventIds, ...data.rejectedEventIds])
          pendingHistoryRef.current.delete(id);
      })
      .catch(() => {
        /* Retain identical event IDs for a later retry. */
      })
      .finally(() => {
        if (historyOwnerRef.current === owner && historyGenerationRef.current === generation)
          historyUploadRef.current = false;
      });
  }, [queryClient]);

  const sampleHistory = useCallback(
    (slot: 0 | 1, audio: HTMLAudioElement) => {
      const entry = entryForSlot(slot);
      if (!entry || !historyOwnerRef.current) return;
      let listening = listeningSessionsRef.current.get(entry.id);
      if (!listening) {
        listening = new MusicListeningSession(makeHistoryId(), entry.trackId, entry.track.duration);
        listeningSessionsRef.current.set(entry.id, listening);
      }
      listening.sample(
        audio.currentTime,
        performance.now() / 1000,
        !audio.paused && !audio.seeking && audio.readyState >= 3,
      );
    },
    [entryForSlot],
  );

  const finalizeHistory = useCallback(
    (entryId: string | null | undefined) => {
      if (!entryId) return;
      const listening = listeningSessionsRef.current.get(entryId);
      const event = listening?.finalize();
      listeningSessionsRef.current.delete(entryId);
      if (event) {
        // Bounded in-memory retry queue, scoped to this authenticated account.
        if (pendingHistoryRef.current.size >= 500)
          pendingHistoryRef.current.delete(pendingHistoryRef.current.keys().next().value!);
        pendingHistoryRef.current.set(event.eventId, event);
        uploadHistory();
      }
    },
    [uploadHistory],
  );

  useEffect(() => {
    if (historyOwnerRef.current === historyOwner) return;
    historyOwnerRef.current = historyOwner;
    historyGenerationRef.current++;
    listeningSessionsRef.current.clear();
    pendingHistoryRef.current.clear();
    historyUploadRef.current = false;
  }, [historyOwner]);
  useEffect(() => {
    const listeningSessions = listeningSessionsRef.current;
    const timer = window.setInterval(uploadHistory, 30_000);
    return () => {
      window.clearInterval(timer);
      for (const id of [...listeningSessions.keys()]) finalizeHistory(id);
    };
  }, [uploadHistory, finalizeHistory]);

  const applySlotGain = useCallback(
    (slot: 0 | 1, track: MusicTrackDto | null, fade = 1, rampSeconds = 0) => {
      const gain = replayGainLinear(track, audioSettings.normalizationEnabled) * fade;
      const graph = graphRef.current;
      const audio = audioRefs.current[slot];
      if (graph) {
        const node = graph.slotGains[slot].gain;
        const now = graph.context.currentTime;
        node.cancelScheduledValues(now);
        node.setValueAtTime(node.value, now);
        if (rampSeconds > 0) node.linearRampToValueAtTime(gain, now + rampSeconds);
        else node.setValueAtTime(gain, now);
        if (audio) audio.volume = 1;
      } else if (audio) {
        audio.volume = Math.min(1, Math.max(0, volume * gain));
      }
    },
    [audioSettings.normalizationEnabled, volume],
  );

  const ensureAudioGraph = useCallback(() => {
    if (graphRef.current) {
      if (graphRef.current.context.state === 'suspended') void graphRef.current.context.resume();
      return graphRef.current;
    }
    const first = audioRefs.current[0];
    const second = audioRefs.current[1];
    if (!first || !second || typeof AudioContext === 'undefined') return null;
    try {
      const context = new AudioContext();
      const slotGains: [GainNode, GainNode] = [context.createGain(), context.createGain()];
      const filters = EQ_FREQUENCIES.map((frequency, index) => {
        const filter = context.createBiquadFilter();
        filter.type =
          index === 0 ? 'lowshelf' : index === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 0.85;
        return filter;
      });
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -2;
      compressor.knee.value = 2;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      const masterGain = context.createGain();
      masterGain.gain.value = volume;
      [first, second].forEach((element, slot) => {
        const source = context.createMediaElementSource(element);
        source.connect(slotGains[slot as 0 | 1]);
        slotGains[slot as 0 | 1].connect(filters[0]!);
        element.volume = 1;
      });
      filters.forEach((filter, index) => filter.connect(filters[index + 1] ?? compressor));
      compressor.connect(masterGain);
      masterGain.connect(context.destination);
      graphRef.current = { context, slotGains, filters, compressor, masterGain };
      filters.forEach((filter, index) => {
        filter.gain.value = audioSettings.equalizerEnabled ? audioSettings.eqGains[index] || 0 : 0;
      });
      applySlotGain(0, entryForSlot(0)?.track || null);
      applySlotGain(1, entryForSlot(1)?.track || null);
      void context.resume();
      return graphRef.current;
    } catch {
      return null;
    }
  }, [applySlotGain, audioSettings.eqGains, audioSettings.equalizerEnabled, entryForSlot, volume]);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph) {
      graph.masterGain.gain.setTargetAtTime(volume, graph.context.currentTime, 0.015);
      graph.filters.forEach((filter, index) => {
        const gain = audioSettings.equalizerEnabled ? audioSettings.eqGains[index] || 0 : 0;
        filter.gain.setTargetAtTime(gain, graph.context.currentTime, 0.02);
      });
    }
    applySlotGain(0, entryForSlot(0)?.track || null);
    applySlotGain(1, entryForSlot(1)?.track || null);
  }, [applySlotGain, audioSettings.eqGains, audioSettings.equalizerEnabled, entryForSlot, volume]);

  useEffect(() => {
    let active = true;
    void fetchMusicPlaybackState(playbackClient)
      .then((state) => {
        if (!active) return;
        revisionRef.current = state.revision;
        setQueue(state.queue);
        const restoredQueueItemId =
          state.currentQueueItemId ||
          state.queue.find((item) => item.trackId === state.currentTrackId)?.id ||
          null;
        setCurrentQueueItemId(restoredQueueItemId);
        const restoredTrack = state.queue.find((item) => item.id === restoredQueueItemId)?.track;
        setTranscode(requiresMusicTranscode(restoredTrack));
        restoredPositionRef.current = state.positionSeconds;
        setPosition(state.positionSeconds);
        setShuffleEnabled(state.shuffleEnabled);
        setRepeatMode(state.repeatMode);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [playbackClient]);

  const snapshot = useCallback(() => {
    const audio = audioRefs.current[activeSlotRef.current];
    return {
      revision: revisionRef.current,
      currentTrackId: currentTrack?.id || null,
      currentQueueItemId,
      positionSeconds: audio
        ? logicalMusicPosition(audio.currentTime, transcode, transcodeStart)
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
    };
  }, [
    currentQueueItemId,
    currentTrack?.id,
    position,
    queue,
    repeatMode,
    shuffleEnabled,
    transcode,
    transcodeStart,
  ]);

  const sync = useCallback(async () => {
    // Slow SQLite writes used to let the ten-second timer start another full
    // queue transaction before the previous one completed. Coalesce every
    // overlapping request into one follow-up write with the latest snapshot.
    if (syncConflictRef.current) return;
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;
    try {
      do {
        syncQueuedRef.current = false;
        const state = snapshot();
        try {
          const result = await saveMusicPlaybackState(state, playbackClient);
          revisionRef.current = result.revision;
        } catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 409) continue;
          try {
            const remote = await fetchMusicPlaybackState(playbackClient);
            revisionRef.current = remote.revision;
            syncConflictRef.current = true;
          } catch {
            // The next queued or periodic sync retries without interrupting playback.
          }
        }
      } while (syncQueuedRef.current);
    } finally {
      syncInFlightRef.current = false;
    }
  }, [playbackClient, snapshot]);

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
      if (currentTrackId) void syncRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [currentTrackId]);

  const loadSlot = useCallback(
    (slot: 0 | 1, entry: MusicQueueEntry, shouldTranscode = false, start = 0) => {
      const audio = audioRefs.current[slot];
      if (!audio) return;
      const source = sourceForTrack(entry.track, playbackClient.clientId, shouldTranscode, start);
      slotEntryIdsRef.current[slot] = entry.id;
      if (audio.getAttribute('src') !== source) {
        audio.src = source;
        audio.load();
      }
    },
    [playbackClient.clientId],
  );

  useEffect(() => {
    if (!currentEntry) return;
    const currentSlot = activeSlotRef.current;
    const otherSlot = currentSlot === 0 ? 1 : 0;
    if (!transcode && slotEntryIdsRef.current[otherSlot] === currentEntry.id) {
      activeSlotRef.current = otherSlot;
    }
    const slot = activeSlotRef.current;
    const audio = audioRefs.current[slot];
    const source = sourceForTrack(
      currentEntry.track,
      playbackClient.clientId,
      transcode,
      transcodeStart,
    );
    if (!audio) return;
    if (slotEntryIdsRef.current[slot] !== currentEntry.id || audio.getAttribute('src') !== source) {
      audioRefs.current.forEach((element, index) => {
        if (index !== slot) element?.pause();
      });
      loadSlot(slot, currentEntry, transcode, transcodeStart);
    }
    applySlotGain(slot, currentEntry.track);
    const start = restoredPositionRef.current;
    restoredPositionRef.current = 0;
    const startPlayback = () => {
      if (!transcode && start > 0 && start < audio.duration) audio.currentTime = start;
      if (pendingPlayRef.current) {
        ensureAudioGraph();
        void audio.play().catch((error: unknown) => {
          console.error('[MusicPlayer] Playback start failed', error);
          if (transcode) pendingPlayRef.current = false;
          setIsPlaying(false);
        });
      }
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) startPlayback();
    else audio.addEventListener('loadedmetadata', startPlayback, { once: true });
    return () => audio.removeEventListener('loadedmetadata', startPlayback);
  }, [
    applySlotGain,
    currentEntry,
    ensureAudioGraph,
    loadSlot,
    playbackClient.clientId,
    transcode,
    transcodeStart,
  ]);

  const getNextEntry = useCallback(
    (entryId = currentQueueItemIdRef.current) => {
      if (!entryId) return null;
      const entries = [...queueRef.current].sort((left, right) => left.playOrder - right.playOrder);
      const index = entries.findIndex((item) => item.id === entryId);
      return entries[index + 1] || (repeatMode === 'all' ? entries[0] : null);
    },
    [repeatMode],
  );

  useEffect(() => {
    if (!currentEntry || transitioning || repeatMode === 'one') return;
    const nextEntry = getNextEntry(currentEntry.id);
    if (!nextEntry) return;
    // A transcoded source starts an FFmpeg process immediately. Do not consume
    // capacity for speculative gapless preloading; start it only when selected.
    if (requiresMusicTranscode(nextEntry.track)) return;
    const inactiveSlot = activeSlotRef.current === 0 ? 1 : 0;
    const inactiveAudio = audioRefs.current[inactiveSlot];
    if (!inactiveAudio) return;
    if (slotEntryIdsRef.current[inactiveSlot] !== nextEntry.id) loadSlot(inactiveSlot, nextEntry);
    inactiveAudio.preload =
      audioSettings.gaplessEnabled || audioSettings.crossfadeSeconds > 0 ? 'auto' : 'metadata';
    applySlotGain(inactiveSlot, nextEntry.track, audioSettings.crossfadeSeconds > 0 ? 0 : 1);
  }, [
    applySlotGain,
    audioSettings.crossfadeSeconds,
    audioSettings.gaplessEnabled,
    currentEntry,
    getNextEntry,
    loadSlot,
    repeatMode,
    transitioning,
  ]);

  const clearTransition = useCallback(() => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = null;
    setTransitioning(false);
  }, []);

  const switchToPrepared = useCallback(
    (entry: MusicQueueEntry, fadeSeconds = 0) => {
      explicitlyPausedRef.current = false;
      const oldSlot = activeSlotRef.current;
      const newSlot = oldSlot === 0 ? 1 : 0;
      const oldAudio = audioRefs.current[oldSlot];
      const newAudio = audioRefs.current[newSlot];
      if (!newAudio || slotEntryIdsRef.current[newSlot] !== entry.id) return false;
      if (oldAudio) sampleHistory(oldSlot, oldAudio);
      finalizeHistory(slotEntryIdsRef.current[oldSlot]);
      clearTransition();
      ensureAudioGraph();
      newAudio.currentTime = 0;
      applySlotGain(newSlot, entry.track, fadeSeconds > 0 ? 0 : 1);
      void newAudio.play().catch(() => setIsPlaying(false));
      if (fadeSeconds > 0) {
        setTransitioning(true);
        applySlotGain(oldSlot, entryForSlot(oldSlot)?.track || null, 0, fadeSeconds);
        applySlotGain(newSlot, entry.track, 1, fadeSeconds);
        transitionTimerRef.current = window.setTimeout(
          () => {
            oldAudio?.pause();
            setTransitioning(false);
            transitionTimerRef.current = null;
          },
          fadeSeconds * 1000 + 80,
        );
      } else oldAudio?.pause();
      activeSlotRef.current = newSlot;
      setCurrentQueueItemId(entry.id);
      setPosition(0);
      setDuration(entry.track.duration || 0);
      setTranscode(false);
      setTranscodeStart(0);
      pendingPlayRef.current = false;
      return true;
    },
    [
      applySlotGain,
      clearTransition,
      ensureAudioGraph,
      entryForSlot,
      sampleHistory,
      finalizeHistory,
    ],
  );

  const selectEntry = useCallback(
    (entry: MusicQueueEntry, autoPlay = true) => {
      explicitlyPausedRef.current = !autoPlay;
      clearTransition();
      const oldSlot = activeSlotRef.current;
      const oldAudio = audioRefs.current[oldSlot];
      if (oldAudio) sampleHistory(oldSlot, oldAudio);
      finalizeHistory(slotEntryIdsRef.current[oldSlot]);
      audioRefs.current.forEach((audio) => audio?.pause());
      setCurrentQueueItemId(entry.id);
      setPosition(0);
      setDuration(entry.track.duration || 0);
      restoredPositionRef.current = 0;
      setTranscode(requiresMusicTranscode(entry.track));
      setTranscodeStart(0);
      pendingPlayRef.current = autoPlay;
    },
    [clearTransition, sampleHistory, finalizeHistory],
  );

  const next = useCallback(() => {
    const candidate = getNextEntry();
    if (candidate) {
      if (!switchToPrepared(candidate)) selectEntry(candidate);
    } else {
      audioRefs.current[activeSlotRef.current]?.pause();
      setIsPlaying(false);
    }
  }, [getNextEntry, selectEntry, switchToPrepared]);

  const extendQueueWithRadio = useCallback((seedEntryId?: string | null) => {
    if (radioExtensionInFlightRef.current) return radioExtensionInFlightRef.current;
    const queueGeneration = queueGenerationRef.current;
    const request = (async () => {
      const seedId = seedEntryId || currentQueueItemIdRef.current;
      const seed = queueRef.current.find((item) => item.id === seedId)?.track;
      if (!seed) return null;
      try {
        const radio = await fetchTrackRadio(seed.id);
        if (queueGenerationRef.current !== queueGeneration) return null;
        const result = appendUniqueMusicQueueEntries(queueRef.current, radio.tracks, makeId);
        if (!result.added.length) return null;
        queueRef.current = result.queue;
        setQueue(result.queue);
        return result.added[0] || null;
      } catch {
        return null;
      }
    })();
    radioExtensionInFlightRef.current = request;
    void request.finally(() => {
      if (radioExtensionInFlightRef.current === request) radioExtensionInFlightRef.current = null;
    });
    return request;
  }, []);

  const toggleContinuousPlay = useCallback(() => {
    setContinuousPlayEnabled((current) => {
      const nextValue = !current;
      try {
        globalThis.localStorage?.setItem(CONTINUOUS_PLAY_KEY, String(nextValue));
      } catch {
        // Keep the in-memory preference.
      }
      return nextValue;
    });
  }, []);

  useEffect(() => {
    if (!continuousPlayEnabled || repeatMode !== 'off') return;
    if (remainingMusicQueueEntries(queue, currentQueueItemId) > 2) return;
    const terminalEntry = [...queue].sort((left, right) => right.playOrder - left.playOrder)[0];
    if (terminalEntry) void extendQueueWithRadio(terminalEntry.id);
  }, [continuousPlayEnabled, currentQueueItemId, extendQueueWithRadio, queue, repeatMode]);

  const previous = useCallback(() => {
    const audio = audioRefs.current[activeSlotRef.current];
    const logicalPosition = audio
      ? logicalMusicPosition(audio.currentTime, transcode, transcodeStart)
      : 0;
    if (audio && logicalPosition > 5) {
      if (transcode) {
        pendingPlayRef.current = !audio.paused;
        setTranscodeStart(0);
      } else audio.currentTime = 0;
      setPosition(0);
      return;
    }
    const entries = [...queueRef.current].sort((left, right) => left.playOrder - right.playOrder);
    const index = entries.findIndex((item) => item.id === currentQueueItemIdRef.current);
    const candidate = entries[index - 1] || (repeatMode === 'all' ? entries.at(-1) : undefined);
    if (candidate) selectEntry(candidate);
  }, [repeatMode, selectEntry, transcode, transcodeStart]);

  const playTracks = useCallback(
    (tracks: MusicTrackDto[], startIndex = 0, position = 0) => {
      queueGenerationRef.current += 1;
      radioExtensionInFlightRef.current = null;
      const entries = tracks.map((track, index) => ({
        id: makeId(),
        trackId: track.id,
        sourceOrder: index,
        playOrder: index,
        track,
      }));
      queueRef.current = entries;
      setQueue(entries);
      setShuffleEnabled(false);
      const first = entries[Math.max(0, Math.min(startIndex, entries.length - 1))];
      if (first) {
        selectEntry(first);
        const start = Number.isFinite(position)
          ? Math.max(0, Math.min(position, Math.max(0, (first.track.duration ?? 86400) - 0.1)))
          : 0;
        restoredPositionRef.current = start;
        setPosition(start);
        if (requiresMusicTranscode(first.track)) setTranscodeStart(start);
      }
    },
    [selectEntry],
  );

  const playShuffledTracks = useCallback(
    (tracks: MusicTrackDto[]) => {
      queueGenerationRef.current += 1;
      radioExtensionInFlightRef.current = null;
      const entries = tracks.map((track, index) => ({
        id: makeId(),
        trackId: track.id,
        sourceOrder: index,
        playOrder: index,
        track,
      }));
      const shuffled = shuffleMusicQueueEntries(entries);
      const first = [...shuffled].sort((left, right) => left.playOrder - right.playOrder)[0];
      queueRef.current = shuffled;
      setQueue(shuffled);
      setShuffleEnabled(true);
      if (first) selectEntry(first);
    },
    [selectEntry],
  );

  const addToQueue = useCallback((track: MusicTrackDto) => {
    setQueue((items) => appendMusicQueueEntry(items, track, makeId()));
  }, []);

  const playNext = useCallback((track: MusicTrackDto) => {
    setQueue((items) =>
      insertNextMusicQueueEntry(items, currentQueueItemIdRef.current, track, makeId()),
    );
  }, []);

  const undoQueueRemoval = useCallback(() => {
    if (!queueRemoval || queueRemoval.owner !== historyOwnerRef.current) return;
    setQueue((items) => (items === queueRemoval.after ? queueRemoval.before : items));
    setQueueRemoval(null);
    // Deliberately do not select an entry, seek, or resume audio.
  }, [queueRemoval]);

  const pause = useCallback(() => {
    explicitlyPausedRef.current = true;
    playbackIntentGenerationRef.current += 1;
    pendingPlayRef.current = false;
    clearTransition();
    audioRefs.current.forEach((audio, slot) => {
      if (audio) sampleHistory(slot as 0 | 1, audio);
      audio?.pause();
    });
    setIsPlaying(false);
    void syncRef.current();
  }, [clearTransition, sampleHistory]);
  const removeFromQueue = useCallback(
    (id: string) => {
      const before = queueRef.current;
      const removed = before.find((item) => item.id === id);
      if (!removed) return;
      const after = removeMusicQueueEntry(before, id);
      setQueueRemoval({ before, after, title: removed.track.title, owner: historyOwner });
      // Use a functional update to preserve any edits queued earlier in this same event.
      setQueue((items) => (items === before ? after : removeMusicQueueEntry(items, id)));
      if (id === currentQueueItemIdRef.current) {
        const successor = getNextEntry();
        if (successor && successor.id !== id) next();
        else pause(); // Also cancel pending autoplay when the last entry has not loaded yet.
      }
    },
    [next, pause, getNextEntry, historyOwner],
  );
  const expireSleepTimer = useCallback(() => {
    pause();
    toast.info(t.music.sleepTimerFinished);
  }, [pause]);
  const sleepTimer = useMusicSleepTimer(historyOwner, expireSleepTimer);
  const { checkExpiry: checkSleepTimerExpiry } = sleepTimer;

  const togglePlay = useCallback(() => {
    const audio = audioRefs.current[activeSlotRef.current];
    if (!audio) return;
    ensureAudioGraph();
    if (audio.paused) {
      explicitlyPausedRef.current = false;
      pendingPlayRef.current = true;
      void audio.play().catch((error: unknown) => {
        console.error('[MusicPlayer] Playback resume failed', error);
        if (transcode) pendingPlayRef.current = false;
        setIsPlaying(false);
      });
    } else pause();
  }, [ensureAudioGraph, transcode, pause]);

  const seek = useCallback(
    (seconds: number) => {
      clearTransition();
      const audio = audioRefs.current[activeSlotRef.current];
      if (audio) sampleHistory(activeSlotRef.current, audio);
      const entry = entryForSlot(activeSlotRef.current);
      if (entry) listeningSessionsRef.current.get(entry.id)?.discontinuity();
      if (transcode) {
        pendingPlayRef.current = isPlaying;
        setTranscodeStart(seconds);
      } else if (audio) audio.currentTime = seconds;
      setPosition(seconds);
      void syncRef.current();
    },
    [clearTransition, isPlaying, transcode, sampleHistory, entryForSlot],
  );

  const setVolume = useCallback((nextVolume: number) => {
    const value = Math.min(1, Math.max(0, nextVolume));
    setVolumeState(value);
    try {
      globalThis.localStorage?.setItem('cinedrive_music_volume', String(value));
    } catch {
      // Keep the in-memory volume.
    }
  }, []);

  const toggleShuffle = useCallback(() => {
    setQueue((items) => {
      if (shuffleEnabled) return items.map((item) => ({ ...item, playOrder: item.sourceOrder }));
      const current = items.find((item) => item.id === currentQueueItemIdRef.current);
      const rest = items
        .filter((item) => item.id !== currentQueueItemIdRef.current)
        .sort(() => Math.random() - 0.5);
      return [...(current ? [current] : []), ...rest].map((item, index) => ({
        ...item,
        playOrder: index,
      }));
    });
    setShuffleEnabled((value) => !value);
  }, [shuffleEnabled]);
  const cycleRepeat = useCallback(
    () => setRepeatMode((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')),
    [],
  );

  const updateAudioSettings = useCallback((settings: Partial<MusicAudioSettings>) => {
    setAudioSettings((current) => {
      const next = { ...current, ...settings };
      try {
        globalThis.localStorage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Keep the in-memory settings.
      }
      return next;
    });
  }, []);
  const setEqPreset = useCallback(
    (preset: Exclude<EqPreset, 'custom'>) =>
      updateAudioSettings({
        eqPreset: preset,
        eqGains: [...EQ_PRESETS[preset]],
        equalizerEnabled: true,
      }),
    [updateAudioSettings],
  );
  const setEqBand = useCallback(
    (index: number, gain: number) => {
      const gains = [...audioSettings.eqGains];
      gains[index] = Math.min(12, Math.max(-12, gain));
      updateAudioSettings({ eqPreset: 'custom', eqGains: gains, equalizerEnabled: true });
    },
    [audioSettings.eqGains, updateAudioSettings],
  );

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      void graphRef.current?.context.close();
    },
    [],
  );

  const handleTimeUpdate = useCallback(
    (slot: 0 | 1, audio: HTMLAudioElement) => {
      if (slot !== activeSlotRef.current) return;
      if (checkSleepTimerExpiry()) return;
      if (explicitlyPausedRef.current) return;
      const seconds = logicalMusicPosition(audio.currentTime, transcode, transcodeStart);
      setPosition(seconds);
      const entry = entryForSlot(slot);
      sampleHistory(slot, audio);
      const fade = audioSettings.crossfadeSeconds;
      if (!transitioning && fade >= 5 && repeatMode !== 'one' && Number.isFinite(audio.duration)) {
        const remaining = audio.duration - audio.currentTime;
        const nextEntry = getNextEntry(entry?.id);
        if (nextEntry && remaining <= fade && remaining > 0.2)
          switchToPrepared(nextEntry, Math.min(fade, remaining));
      }
    },
    [
      audioSettings.crossfadeSeconds,
      entryForSlot,
      getNextEntry,
      sampleHistory,
      repeatMode,
      switchToPrepared,
      transcode,
      transcodeStart,
      transitioning,
      checkSleepTimerExpiry,
    ],
  );

  const handleEnded = useCallback(
    async (slot: 0 | 1) => {
      if (slot !== activeSlotRef.current) return;
      if (checkSleepTimerExpiry()) return;
      if (explicitlyPausedRef.current) return;
      const audio = audioRefs.current[slot];
      const entry = entryForSlot(slot);
      if (audio && entry) {
        sampleHistory(slot, audio);
        finalizeHistory(entry.id);
      }
      if (repeatMode === 'one' && audio) {
        if (transcode && transcodeStart > 0) {
          pendingPlayRef.current = true;
          setTranscodeStart(0);
          setPosition(0);
        } else {
          audio.currentTime = 0;
          void audio.play();
        }
        return;
      }
      const candidate = getNextEntry();
      if (candidate && audioSettings.gaplessEnabled && switchToPrepared(candidate)) return;
      if (candidate) {
        next();
        return;
      }
      if (continuousPlayEnabled) {
        const intentGeneration = playbackIntentGenerationRef.current;
        const generated = await extendQueueWithRadio();
        if (intentGeneration !== playbackIntentGenerationRef.current || checkSleepTimerExpiry())
          return;
        if (generated) {
          selectEntry(generated);
          return;
        }
      }
      next();
    },
    [
      audioSettings.gaplessEnabled,
      continuousPlayEnabled,
      entryForSlot,
      extendQueueWithRadio,
      getNextEntry,
      next,
      sampleHistory,
      finalizeHistory,
      repeatMode,
      selectEntry,
      switchToPrepared,
      transcode,
      transcodeStart,
      checkSleepTimerExpiry,
    ],
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
      continuousPlayEnabled,
      audioSettings,
      playTracks,
      playShuffledTracks,
      playQueueItem: (id) => {
        const entry = queue.find((item) => item.id === id);
        if (entry) selectEntry(entry);
      },
      addToQueue,
      playNext,
      removeFromQueue,
      removedQueueTitle:
        queueRemoval?.after === queue && queueRemoval.owner === historyOwner
          ? queueRemoval.title
          : null,
      undoQueueRemoval,
      togglePlay,
      pause,
      sleepTimerEndsAt: sleepTimer.endsAt,
      setSleepTimer: sleepTimer.setSleepTimer,
      next,
      previous,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      toggleContinuousPlay,
      updateAudioSettings,
      setEqPreset,
      setEqBand,
    }),
    [
      addToQueue,
      audioSettings,
      currentQueueItemId,
      currentTrack,
      continuousPlayEnabled,
      cycleRepeat,
      duration,
      isPlaying,
      next,
      orderedQueue,
      playNext,
      playShuffledTracks,
      playTracks,
      position,
      previous,
      queue,
      removeFromQueue,
      queueRemoval,
      historyOwner,
      undoQueueRemoval,
      repeatMode,
      seek,
      selectEntry,
      setEqBand,
      setEqPreset,
      setVolume,
      shuffleEnabled,
      togglePlay,
      pause,
      sleepTimer.endsAt,
      sleepTimer.setSleepTimer,
      toggleContinuousPlay,
      toggleShuffle,
      updateAudioSettings,
      volume,
    ],
  );

  const renderAudio = (slot: 0 | 1) => (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- music tracks do not have caption tracks
    <audio
      key={slot}
      ref={(element) => {
        audioRefs.current[slot] = element;
      }}
      preload="auto"
      onPlay={() => {
        if (slot === activeSlotRef.current) {
          if (checkSleepTimerExpiry()) return;
          explicitlyPausedRef.current = false;
          pendingPlayRef.current = false;
          setIsPlaying(true);
        }
      }}
      onPlaying={(event) => {
        if (slot === activeSlotRef.current) sampleHistory(slot, event.currentTarget);
      }}
      onWaiting={() => {
        const entry = entryForSlot(slot);
        if (entry) listeningSessionsRef.current.get(entry.id)?.discontinuity();
      }}
      onSeeking={() => {
        const entry = entryForSlot(slot);
        if (entry) listeningSessionsRef.current.get(entry.id)?.discontinuity();
      }}
      onPause={() => {
        const entry = entryForSlot(slot);
        if (entry) listeningSessionsRef.current.get(entry.id)?.discontinuity();
        if (slot === activeSlotRef.current && !transitioning) {
          setIsPlaying(false);
          void syncRef.current();
        }
      }}
      onDurationChange={(event) => {
        if (slot !== activeSlotRef.current) return;
        setDuration(
          transcode
            ? currentTrack?.duration || 0
            : Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : currentTrack?.duration || 0,
        );
      }}
      onTimeUpdate={(event) => handleTimeUpdate(slot, event.currentTarget)}
      onEnded={() => handleEnded(slot)}
      onError={(event) => {
        if (slot !== activeSlotRef.current) return;
        const mediaError = event.currentTarget.error;
        const errorCodes: Record<number, string> = {
          1: 'MEDIA_ABORTED',
          2: 'MEDIA_NETWORK_ERROR',
          3: 'MEDIA_DECODE_ERROR',
          4: 'MEDIA_SOURCE_UNSUPPORTED',
        };
        console.error('[MusicPlayer] music_stream_error', {
          side: 'web_client',
          code: mediaError
            ? errorCodes[mediaError.code] || `MEDIA_ERROR_${mediaError.code}`
            : 'MEDIA_ERROR_UNKNOWN',
          trackId: currentTrack?.id,
          clientId: playbackClient.clientId,
          transcode,
        });
        if (currentTrack && !transcode) {
          restoredPositionRef.current = 0;
          pendingPlayRef.current = pendingPlayRef.current || isPlaying;
          setTranscodeStart(position);
          setTranscode(true);
        } else {
          pendingPlayRef.current = false;
          setIsPlaying(false);
        }
      }}
      className="hidden"
    />
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      {renderAudio(0)}
      {renderAudio(1)}
    </MusicPlayerContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- provider and hook intentionally share one context module
export const useMusicPlayer = () => {
  const context = useContext(MusicPlayerContext);
  if (!context) throw new Error('useMusicPlayer must be used inside MusicPlayerProvider');
  return context;
};

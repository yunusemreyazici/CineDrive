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
  appendMusicQueueEntry,
  insertNextMusicQueueEntry,
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
  audioSettings: MusicAudioSettings;
  playTracks: (tracks: MusicTrackDto[], startIndex?: number) => void;
  playShuffledTracks: (tracks: MusicTrackDto[]) => void;
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
const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const sourceForTrack = (track: MusicTrackDto, transcode = false, start = 0) =>
  `${track.streamUrl}${transcode ? `?transcode=1&start=${Math.floor(start)}` : ''}`;

export const MusicPlayerProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const audioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const slotEntryIdsRef = useRef<[string | null, string | null]>([null, null]);
  const activeSlotRef = useRef<0 | 1>(0);
  const graphRef = useRef<AudioGraph | null>(null);
  const queueRef = useRef<MusicQueueEntry[]>([]);
  const currentQueueItemIdRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const historyRecordedRef = useRef(new Set<string>());
  const historyPendingRef = useRef(new Set<string>());
  const pendingPlayRef = useRef(false);
  const restoredPositionRef = useRef(0);
  const transitionTimerRef = useRef<number | null>(null);
  const [queue, setQueue] = useState<MusicQueueEntry[]>([]);
  const [currentQueueItemId, setCurrentQueueItemId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
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

  const orderedQueue = useMemo(() => [...queue].sort((a, b) => a.playOrder - b.playOrder), [queue]);
  const currentEntry = queue.find((item) => item.id === currentQueueItemId) || null;
  const currentTrack = currentEntry?.track || null;
  const currentTrackId = currentTrack?.id || null;

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
    void fetchMusicPlaybackState()
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
  }, []);

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
          const result = await saveMusicPlaybackState(state);
          revisionRef.current = result.revision;
        } catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 409) continue;
          try {
            const remote = await fetchMusicPlaybackState();
            revisionRef.current = remote.revision;
            const result = await saveMusicPlaybackState({ ...state, revision: remote.revision });
            revisionRef.current = result.revision;
          } catch {
            // The next queued or periodic sync retries without interrupting playback.
          }
        }
      } while (syncQueuedRef.current);
    } finally {
      syncInFlightRef.current = false;
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
      if (currentTrackId) void syncRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [currentTrackId]);

  const loadSlot = useCallback(
    (slot: 0 | 1, entry: MusicQueueEntry, shouldTranscode = false, start = 0) => {
      const audio = audioRefs.current[slot];
      if (!audio) return;
      const source = sourceForTrack(entry.track, shouldTranscode, start);
      slotEntryIdsRef.current[slot] = entry.id;
      if (audio.getAttribute('src') !== source) {
        audio.src = source;
        audio.load();
      }
    },
    [],
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
    const source = sourceForTrack(currentEntry.track, transcode, transcodeStart);
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
  }, [applySlotGain, currentEntry, ensureAudioGraph, loadSlot, transcode, transcodeStart]);

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
      const oldSlot = activeSlotRef.current;
      const newSlot = oldSlot === 0 ? 1 : 0;
      const oldAudio = audioRefs.current[oldSlot];
      const newAudio = audioRefs.current[newSlot];
      if (!newAudio || slotEntryIdsRef.current[newSlot] !== entry.id) return false;
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
      historyRecordedRef.current.delete(entry.id);
      historyPendingRef.current.delete(entry.id);
      return true;
    },
    [applySlotGain, clearTransition, ensureAudioGraph, entryForSlot],
  );

  const selectEntry = useCallback(
    (entry: MusicQueueEntry, autoPlay = true) => {
      clearTransition();
      audioRefs.current.forEach((audio) => audio?.pause());
      setCurrentQueueItemId(entry.id);
      setPosition(0);
      setDuration(entry.track.duration || 0);
      restoredPositionRef.current = 0;
      setTranscode(requiresMusicTranscode(entry.track));
      setTranscodeStart(0);
      pendingPlayRef.current = autoPlay;
      historyRecordedRef.current.delete(entry.id);
      historyPendingRef.current.delete(entry.id);
    },
    [clearTransition],
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
    (tracks: MusicTrackDto[], startIndex = 0) => {
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
      if (first) selectEntry(first);
    },
    [selectEntry],
  );

  const playShuffledTracks = useCallback(
    (tracks: MusicTrackDto[]) => {
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

  const removeFromQueue = useCallback(
    (id: string) => {
      setQueue((items) => removeMusicQueueEntry(items, id));
      if (id === currentQueueItemIdRef.current) next();
    },
    [next],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRefs.current[activeSlotRef.current];
    if (!audio) return;
    ensureAudioGraph();
    if (audio.paused) {
      pendingPlayRef.current = true;
      void audio.play().catch((error: unknown) => {
        console.error('[MusicPlayer] Playback resume failed', error);
        if (transcode) pendingPlayRef.current = false;
        setIsPlaying(false);
      });
    } else audio.pause();
  }, [ensureAudioGraph, transcode]);

  const seek = useCallback(
    (seconds: number) => {
      clearTransition();
      const audio = audioRefs.current[activeSlotRef.current];
      if (transcode) {
        pendingPlayRef.current = isPlaying;
        setTranscodeStart(seconds);
      } else if (audio) audio.currentTime = seconds;
      setPosition(seconds);
      void syncRef.current();
    },
    [clearTransition, isPlaying, transcode],
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

  const recordMusicHistory = useCallback((entry: MusicQueueEntry, listenedSeconds: number) => {
    if (historyRecordedRef.current.has(entry.id) || historyPendingRef.current.has(entry.id)) return;
    historyPendingRef.current.add(entry.id);
    void apiClient
      .post('/music/history', { trackId: entry.trackId, listenedSeconds })
      .then(() => historyRecordedRef.current.add(entry.id))
      .catch(() => {})
      .finally(() => historyPendingRef.current.delete(entry.id));
  }, []);

  const handleTimeUpdate = useCallback(
    (slot: 0 | 1, audio: HTMLAudioElement) => {
      if (slot !== activeSlotRef.current) return;
      const seconds = logicalMusicPosition(audio.currentTime, transcode, transcodeStart);
      setPosition(seconds);
      const entry = entryForSlot(slot);
      const historyThreshold = Math.min(30, entry?.track.duration || audio.duration || 30);
      if (
        entry &&
        !historyRecordedRef.current.has(entry.id) &&
        !historyPendingRef.current.has(entry.id) &&
        seconds + 0.5 >= historyThreshold
      ) {
        recordMusicHistory(entry, seconds);
      }
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
      recordMusicHistory,
      repeatMode,
      switchToPrepared,
      transcode,
      transcodeStart,
      transitioning,
    ],
  );

  const handleEnded = useCallback(
    (slot: 0 | 1) => {
      if (slot !== activeSlotRef.current) return;
      const audio = audioRefs.current[slot];
      const entry = entryForSlot(slot);
      if (audio && entry) {
        const listenedSeconds = logicalMusicPosition(audio.currentTime, transcode, transcodeStart);
        recordMusicHistory(entry, Math.max(entry.track.duration || 0, listenedSeconds));
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
      next();
    },
    [
      audioSettings.gaplessEnabled,
      entryForSlot,
      getNextEntry,
      next,
      recordMusicHistory,
      repeatMode,
      switchToPrepared,
      transcode,
      transcodeStart,
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
      togglePlay,
      next,
      previous,
      seek,
      setVolume,
      toggleShuffle,
      cycleRepeat,
      updateAudioSettings,
      setEqPreset,
      setEqBand,
    }),
    [
      addToQueue,
      audioSettings,
      currentQueueItemId,
      currentTrack,
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
      repeatMode,
      seek,
      selectEntry,
      setEqBand,
      setEqPreset,
      setVolume,
      shuffleEnabled,
      togglePlay,
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
          pendingPlayRef.current = false;
          setIsPlaying(true);
        }
      }}
      onPause={() => {
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
      onError={() => {
        if (slot !== activeSlotRef.current) return;
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

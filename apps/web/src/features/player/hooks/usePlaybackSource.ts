import { useCallback, useMemo, useReducer } from 'react';
import type { PlaybackMode } from '../../../types/media';
import type { QualityPreference } from '../components/QualityMenu';
import { chooseAutoQuality } from '../utils/playerBrowser';

const QUALITY_STORAGE_KEY = 'cinedrive-player-quality-v1';

const getQualityStorage = () => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const readStoredQualityPreference = (): QualityPreference => {
  const stored = getQualityStorage()?.getItem(QUALITY_STORAGE_KEY);
  return stored === 'original' || stored === '1080p' || stored === '720p' || stored === '480p'
    ? stored
    : 'auto';
};

const persistQualityPreference = (quality: QualityPreference) => {
  try {
    getQualityStorage()?.setItem(QUALITY_STORAGE_KEY, quality);
  } catch {
    // The preference remains valid for the current session.
  }
};

/**
 * Everything that decides *which bytes the video element is pulling*. These
 * five values only ever change together — a seek past the transcode window
 * changes the offset AND the session, a stall downshift changes the quality AND
 * the generation — so keeping them in separate useState calls made every
 * recovery path a multi-setter dance with its own ordering bugs.
 */
interface PlaybackSourceState {
  playbackMode: PlaybackMode;
  /** Absolute position (seconds) the server-side transcode starts from. */
  startOffset: number;
  /** Bumped to force a brand new server-side job for the same offset. */
  generation: number;
  qualityPreference: QualityPreference;
  adaptiveQuality: '1080p' | '720p' | '480p';
}

type PlaybackSourceAction =
  /** A new episode/movie, or the recommended mode changed. */
  | { type: 'reset'; playbackMode: PlaybackMode; adaptiveQuality: '1080p' | '720p' | '480p' }
  /** Restart the stream from an absolute position. */
  | { type: 'seekTo'; offsetSeconds: number }
  /** Same offset, fresh server job (reconnect after a stall or fatal error). */
  | { type: 'restart' }
  /** Switch compatibility mode, optionally carrying the current position. */
  | { type: 'setMode'; playbackMode: PlaybackMode; offsetSeconds?: number }
  | { type: 'setQualityPreference'; quality: QualityPreference; automatic: '1080p' | '720p' | '480p' }
  /** Auto-downshift after a stall. */
  | { type: 'setAdaptiveQuality'; quality: '1080p' | '720p' | '480p' };

const reducer = (state: PlaybackSourceState, action: PlaybackSourceAction): PlaybackSourceState => {
  switch (action.type) {
    case 'reset':
      return {
        ...state,
        playbackMode: action.playbackMode,
        startOffset: 0,
        generation: 0,
        adaptiveQuality: action.adaptiveQuality,
      };
    case 'seekTo':
      // Re-requesting the same offset must still produce a new job, otherwise
      // the element reloads a stream the server already tore down.
      return state.startOffset === action.offsetSeconds
        ? { ...state, generation: state.generation + 1 }
        : { ...state, startOffset: action.offsetSeconds };
    case 'restart':
      return { ...state, generation: state.generation + 1 };
    case 'setMode':
      return {
        ...state,
        playbackMode: action.playbackMode,
        startOffset:
          action.offsetSeconds !== undefined ? action.offsetSeconds : state.startOffset,
      };
    case 'setQualityPreference':
      return {
        ...state,
        qualityPreference: action.quality,
        adaptiveQuality: action.quality === 'auto' ? action.automatic : state.adaptiveQuality,
      };
    case 'setAdaptiveQuality':
      return { ...state, adaptiveQuality: action.quality };
    default:
      return state;
  }
};

const createSessionId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `player_${Date.now()}_${Math.random().toString(36).slice(2)}`;

interface UsePlaybackSourceOptions {
  driveFileId: string | null;
  recommendedMode: PlaybackMode;
  /** Source height, used to cap the automatic quality. */
  sourceHeight?: number;
}

export const usePlaybackSource = ({
  driveFileId,
  recommendedMode,
  sourceHeight,
}: UsePlaybackSourceOptions) => {
  const automaticQuality = chooseAutoQuality(sourceHeight);

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    playbackMode: recommendedMode,
    startOffset: 0,
    generation: 0,
    qualityPreference: readStoredQualityPreference(),
    adaptiveQuality: automaticQuality,
  }));

  const effectiveQuality =
    state.qualityPreference === 'auto' ? state.adaptiveQuality : state.qualityPreference;
  const useTranscode = state.playbackMode !== 'direct';
  const timelineOffset = useTranscode ? state.startOffset : 0;

  // A source generation owns exactly one server-side FFmpeg job. Reusing a
  // tab-wide owner ID allowed the cleanup request for an old source to kill a
  // replacement stream that had already started.
  const sessionId = useMemo(
    () => createSessionId(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new id is exactly what each of these changes should produce
    [effectiveQuality, state.startOffset, state.playbackMode, state.generation, driveFileId],
  );

  const sourceUrl = useMemo(() => {
    if (!driveFileId) return '';
    const { playbackMode, startOffset } = state;

    if (playbackMode === 'hls') {
      return `/api/media/${driveFileId}/hls/index.m3u8?start=${startOffset}&session=${sessionId}`;
    }
    if (playbackMode === 'audio') {
      return `/api/media/${driveFileId}/stream?transcode=audio&start=${startOffset}&session=${sessionId}`;
    }
    if (playbackMode === 'full') {
      return `/api/media/${driveFileId}/stream?transcode=full&quality=${effectiveQuality}&start=${startOffset}&session=${sessionId}`;
    }
    return `/api/media/${driveFileId}/stream`;
  }, [driveFileId, effectiveQuality, sessionId, state]);

  const selectQuality = useCallback(
    (quality: QualityPreference) => {
      persistQualityPreference(quality);
      dispatch({ type: 'setQualityPreference', quality, automatic: automaticQuality });
    },
    [automaticQuality],
  );

  return {
    ...state,
    automaticQuality,
    effectiveQuality,
    useTranscode,
    timelineOffset,
    sessionId,
    sourceUrl,
    dispatch,
    selectQuality,
  };
};

export type PlaybackSource = ReturnType<typeof usePlaybackSource>;

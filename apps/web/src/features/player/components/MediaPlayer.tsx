import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Clock } from 'lucide-react';
import { PlayerControls } from './PlayerControls';
import { ResumeOverlay } from './ResumeOverlay';
import { NextEpisodeOverlay } from './NextEpisodeOverlay';
import { PlayerError } from './PlayerError';
import { usePlayerStore } from '../stores/usePlayerStore';
import { useUiStore } from '../../../stores/useUiStore';
import { usePlaybackProgress } from '../hooks/usePlaybackProgress';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePlayerControls } from '../hooks/usePlayerControls';
import { useHlsPlayback } from '../hooks/useHlsPlayback';
import { convertSrtToVtt } from '@cinedrive/shared';
import type { PlayerErrorState, SubtitleTrackType } from '../types/player';
import { findActiveSubtitleCue, parseWebVttCues, type SubtitleCue } from '../utils/subtitleCues';
import type {
  MediaItemType,
  EpisodeType,
  PlaybackMode,
  PlaybackPlanType,
  SubtitleItemType,
} from '../../../types/media';
import type { QualityPreference } from './QualityMenu';

interface MediaPlayerProps {
  media: MediaItemType;
  episodeId?: string;
}

export const isSafariBrowser = (
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
) => {
  // Chrome, Firefox and Edge on iOS are Safari/WebKit under the hood and need
  // the same native HLS compatibility path. Their branded user-agent tokens
  // must not route MKV files through the desktop Chromium strategy.
  const isAppleMobileWebKit =
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (isAppleMobileWebKit) return true;

  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(userAgent);
};

const STALL_RECOVERY_DELAY_MS = 12_000;
const MAX_STALL_RECOVERY_ATTEMPTS = 2;
const HLS_SEEK_DEBOUNCE_MS = 400;
const QUALITY_STORAGE_KEY = 'cinedrive-player-quality-v1';
const SUBTITLE_PREFERENCE_STORAGE_KEY = 'cinedrive-subtitle-preference-v1';

const createHlsSessionId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `player_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const alignSubtitleCueToPlaybackTimeline = (
  startTime: number,
  endTime: number,
  timelineOffset: number,
  subtitleDelay: number,
) => {
  const alignedStart = Math.max(0, startTime - timelineOffset + subtitleDelay);
  return {
    startTime: alignedStart,
    endTime: Math.max(alignedStart + 0.001, endTime - timelineOffset + subtitleDelay),
  };
};

const formatWebVttTimestamp = (seconds: number) => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`;
};

export const serializeSubtitleCuesToVtt = (cues: SubtitleCue[]) =>
  `WEBVTT\n\n${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatWebVttTimestamp(cue.startTime)} --> ${formatWebVttTimestamp(
          cue.endTime,
        )}\n${cue.text}`,
    )
    .join('\n\n')}\n`;

const getNativeSubtitleSource = (subtitle: SubtitleTrackType) => {
  if (subtitle.url) return subtitle.url;
  if (subtitle.src) return subtitle.src;
  if (subtitle.cues?.length) {
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(
      serializeSubtitleCuesToVtt(subtitle.cues),
    )}`;
  }
  return `/api/media/${subtitle.id}/subtitle`;
};

export const getBufferedAheadSeconds = (video: HTMLVideoElement) => {
  for (let index = 0; index < video.buffered.length; index++) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (video.currentTime >= start - 0.05 && video.currentTime <= end) {
      return Math.max(0, end - video.currentTime);
    }
  }
  return 0;
};

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

type WebkitFullscreenDocument = Document & {
  webkitExitFullscreen?: () => void;
  webkitFullscreenElement?: Element | null;
};

export const togglePlayerFullscreen = async (video: HTMLVideoElement, container: HTMLElement) => {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  const webkitVideo = video as WebkitFullscreenVideo;

  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return 'exited' as const;
  }

  if (fullscreenDocument.webkitFullscreenElement) {
    fullscreenDocument.webkitExitFullscreen?.();
    return 'exited' as const;
  }

  if (webkitVideo.webkitDisplayingFullscreen) {
    webkitVideo.webkitExitFullscreen?.();
    return 'exited' as const;
  }

  // iPhone Safari does not expose the standard Fullscreen API for arbitrary
  // elements. Its native video fullscreen method must run directly inside the
  // user gesture, so use it before any asynchronous fallback.
  if (!container.requestFullscreen && webkitVideo.webkitEnterFullscreen) {
    webkitVideo.webkitEnterFullscreen();
    return 'native-video' as const;
  }

  if (container.requestFullscreen) {
    try {
      await container.requestFullscreen();
      return 'container' as const;
    } catch {
      if (webkitVideo.webkitEnterFullscreen) {
        webkitVideo.webkitEnterFullscreen();
        return 'native-video' as const;
      }
      throw new Error('FULLSCREEN_NOT_SUPPORTED');
    }
  }

  if (video.requestFullscreen) {
    await video.requestFullscreen();
    return 'video' as const;
  }

  if (webkitVideo.webkitEnterFullscreen) {
    webkitVideo.webkitEnterFullscreen();
    return 'native-video' as const;
  }

  throw new Error('FULLSCREEN_NOT_SUPPORTED');
};

export const normalizeSubtitleTrack = (
  subtitle: SubtitleItemType | SubtitleTrackType,
): SubtitleTrackType => {
  const apiSubtitle = subtitle as SubtitleItemType;
  const playerSubtitle = subtitle as SubtitleTrackType;
  const language = playerSubtitle.language || apiSubtitle.languageCode || 'und';

  return {
    id: subtitle.id,
    language,
    label:
      playerSubtitle.label ||
      apiSubtitle.languageLabel ||
      (language === 'und' ? 'Bilinmeyen Dil' : language.toUpperCase()),
    isForced: playerSubtitle.isForced ?? apiSubtitle.forced ?? false,
    isHearingImpaired: playerSubtitle.isHearingImpaired ?? apiSubtitle.hearingImpaired ?? false,
    isDefault: subtitle.isDefault ?? false,
    url: subtitle.url,
    src: playerSubtitle.src,
    cues: playerSubtitle.cues,
  };
};

const getQualityStorage = () => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const initialQualityPreference = (): QualityPreference => {
  const stored = getQualityStorage()?.getItem(QUALITY_STORAGE_KEY);
  return stored === 'original' || stored === '1080p' || stored === '720p' || stored === '480p'
    ? stored
    : 'auto';
};

const chooseAutoQuality = (sourceHeight?: number) => {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
      deviceMemory?: number;
    }
  ).connection;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  let quality: '1080p' | '720p' | '480p' =
    connection?.saveData || connection?.effectiveType === '2g'
      ? '480p'
      : connection?.effectiveType === '3g' || (deviceMemory !== undefined && deviceMemory <= 4)
        ? '720p'
        : '1080p';

  if (sourceHeight && sourceHeight <= 480) quality = '480p';
  else if (sourceHeight && sourceHeight <= 720 && quality === '1080p') quality = '720p';
  return quality;
};

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ media, episodeId }) => {
  const navigate = useNavigate();
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSafari = isSafariBrowser();

  // Player Store State
  const {
    volume,
    isMuted,
    playbackSpeed,
    activeSubtitleId,
    autoPlayNext,
    subtitleDelay,
    subtitleFontSize,
    subtitleBgColor,
    setVolume,
    setIsMuted,
    setPlaybackSpeed,
    setActiveSubtitleId,
    setSubtitleDelay,
  } = usePlayerStore();
  const { cinemaMode } = useUiStore();

  const audioCompatibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stablePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceErrorRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHlsSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRecoveryAttemptsRef = useRef(0);
  const sourceErrorRecoveryAttemptsRef = useRef(0);
  const recoveryPositionRef = useRef<number | null>(null);
  const resumeAfterSourceChangeRef = useRef<PlaybackMode | null>(null);
  const resumePromptHandledRef = useRef(false);
  const suppressNextEpisodeUntilRef = useRef(0);
  const sourceStartedAtRef = useRef(performance.now());
  const firstFrameReportedRef = useRef(false);
  const stallStartedAtRef = useRef<number | null>(null);
  const seekStartedAtRef = useRef<number | null>(null);
  const lastTimeUpdateRef = useRef(0);
  const originalCueTimesRef = useRef(
    new WeakMap<TextTrackCue, { startTime: number; endTime: number }>(),
  );

  // Local Media & Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showNextEpisodeModal, setShowNextEpisodeModal] = useState(false);
  const nextEpisodeDismissedRef = useRef(false);
  const [errorState, setErrorState] = useState<PlayerErrorState | null>(null);
  const [customSubtitles, setCustomSubtitles] = useState<SubtitleTrackType[]>([]);
  const [persistedSubtitleCues, setPersistedSubtitleCues] = useState<
    Record<string, SubtitleTrackType['cues']>
  >({});
  const [subtitleTrackLoadVersion, setSubtitleTrackLoadVersion] = useState(0);
  const [isNativeVideoFullscreen, setIsNativeVideoFullscreen] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [qualityPreference, setQualityPreference] =
    useState<QualityPreference>(initialQualityPreference);
  const [streamGeneration, setStreamGeneration] = useState(0);

  const { areControlsVisible, resetHideTimer } = usePlayerControls(isPlaying);

  // Determine active drive file ID and episode details
  let targetDriveFileId: string | null = null;
  let titleDisplay = media.title;
  let episodes: EpisodeType[] = [];
  let currentEpisodeIndex = -1;
  let serverSubtitles: SubtitleTrackType[] = [];
  let currentSeasonNum: number | undefined = undefined;
  let currentEpisodeNum: number | undefined = undefined;
  let activeEpisodeId: string | undefined = episodeId;
  let playbackPlan: PlaybackPlanType | undefined;
  let analyzedDuration: number | undefined;
  let analyzedHeight: number | undefined;
  let activeProgress = media.progress || null;

  if (media.type === 'movie' && media.movie) {
    targetDriveFileId = media.movie.driveFileId;
    playbackPlan = media.movie.playbackPlan;
    analyzedDuration = media.movie.technicalMetadata?.mediaDuration;
    analyzedHeight = media.movie.technicalMetadata?.mediaHeight;
    serverSubtitles = (media.subtitles || []).map(normalizeSubtitleTrack);
  } else if (media.type === 'series' && media.series) {
    episodes = media.series.seasons.flatMap((s) => s.episodes);
    currentEpisodeIndex = episodeId ? episodes.findIndex((e) => e.id === episodeId) : 0;

    const activeEp = episodes[currentEpisodeIndex < 0 ? 0 : currentEpisodeIndex];
    if (activeEp) {
      activeEpisodeId = activeEp.id;
      activeProgress = activeEp.playbackProgresses?.[0] || media.progress || null;
      targetDriveFileId = activeEp.driveFileId;
      playbackPlan = activeEp.playbackPlan;
      analyzedDuration = activeEp.technicalMetadata?.mediaDuration;
      analyzedHeight = activeEp.technicalMetadata?.mediaHeight;
      currentSeasonNum = activeEp.seasonNumber;
      currentEpisodeNum = activeEp.episodeNumber;
      titleDisplay = `${media.title} - ${activeEp.seasonNumber}x${activeEp.episodeNumber < 10 ? `0${activeEp.episodeNumber}` : activeEp.episodeNumber} ${activeEp.title}`;
      serverSubtitles = (activeEp.subtitles || media.subtitles || []).map(normalizeSubtitleTrack);
    }
  }

  const recommendedPlaybackMode: PlaybackMode = isSafari
    ? playbackPlan?.safari || 'direct'
    : playbackPlan?.chromium || 'direct';
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(recommendedPlaybackMode);
  const [hlsStartOffset, setHlsStartOffset] = useState(0);
  const useTranscode = playbackMode !== 'direct';
  const playbackTimelineOffset = useTranscode ? hlsStartOffset : 0;
  const automaticQuality = chooseAutoQuality(analyzedHeight);
  const [adaptiveQuality, setAdaptiveQuality] = useState(automaticQuality);
  const effectiveQuality = qualityPreference === 'auto' ? adaptiveQuality : qualityPreference;
  // A source generation owns exactly one server-side FFmpeg job. Reusing a
  // tab-wide owner ID allowed the cleanup request for an old source to kill a
  // replacement stream that had already started.
  const streamSessionId = useMemo(
    createHlsSessionId,
    [
      effectiveQuality,
      hlsStartOffset,
      playbackMode,
      streamGeneration,
      targetDriveFileId,
    ],
  );

  React.useEffect(() => {
    if (pendingHlsSeekTimerRef.current) {
      clearTimeout(pendingHlsSeekTimerRef.current);
      pendingHlsSeekTimerRef.current = null;
    }
    setPlaybackMode(recommendedPlaybackMode);
    setHlsStartOffset(0);
    resumePromptHandledRef.current = false;
    setShowResumeModal(false);
    setErrorState(null);
    stallRecoveryAttemptsRef.current = 0;
    recoveryPositionRef.current = null;
    setConnectionMessage(null);
    setAdaptiveQuality(automaticQuality);
    sourceErrorRecoveryAttemptsRef.current = 0;
  }, [automaticQuality, recommendedPlaybackMode, targetDriveFileId]);

  const subtitleOwnerId = activeEpisodeId || media.id;
  const availableSubtitles = Array.from(
    new Map(
      [...serverSubtitles, ...customSubtitles].map((subtitle) => [subtitle.id, subtitle]),
    ).values(),
  );
  const resolvedSubtitles = availableSubtitles.map((subtitle) => {
    const persistedCues = persistedSubtitleCues[subtitle.id];
    return persistedCues?.length ? { ...subtitle, cues: persistedCues } : subtitle;
  });
  const subtitleAvailabilityKey = availableSubtitles.map((subtitle) => subtitle.id).join('|');
  const subtitlePreferenceKey = `${SUBTITLE_PREFERENCE_STORAGE_KEY}:${subtitleOwnerId}`;
  // iPhone Safari displays only the native video layer in fullscreen. Keep
  // every subtitle source as a real text track so downloaded and locally
  // uploaded subtitles remain visible there as well.
  const nativeSubtitles = resolvedSubtitles;
  const activeOverlaySubtitle = resolvedSubtitles.find(
    (subtitle) =>
      subtitle.cues?.length &&
      (subtitle.id === activeSubtitleId || (subtitle.isDefault && !activeSubtitleId)),
  );
  const activeOverlayCue = activeOverlaySubtitle?.cues
    ? findActiveSubtitleCue(activeOverlaySubtitle.cues, currentTime, subtitleDelay)
    : undefined;

  const createdUrlsRef = useRef<string[]>([]);

  React.useEffect(() => {
    setCustomSubtitles([]);
    setPersistedSubtitleCues({});
  }, [subtitleOwnerId]);

  const selectSubtitle = useCallback(
    (subtitleId: string | null) => {
      setActiveSubtitleId(subtitleId);
      try {
        window.localStorage.setItem(subtitlePreferenceKey, subtitleId || 'off');
      } catch {
        // The in-memory selection still works when storage is unavailable.
      }
    },
    [setActiveSubtitleId, subtitlePreferenceKey],
  );

  React.useEffect(() => {
    let storedPreference: string | null = null;
    try {
      storedPreference = window.localStorage.getItem(subtitlePreferenceKey);
    } catch {
      // Fall back to the server default.
    }

    if (storedPreference === 'off') {
      setActiveSubtitleId(null);
      return;
    }
    if (
      storedPreference &&
      availableSubtitles.some((subtitle) => subtitle.id === storedPreference)
    ) {
      setActiveSubtitleId(storedPreference);
      return;
    }

    const defaultSubtitle = availableSubtitles.find((subtitle) => subtitle.isDefault);
    setActiveSubtitleId(defaultSubtitle?.id || null);
  }, [setActiveSubtitleId, subtitleAvailabilityKey, subtitlePreferenceKey]);

  const selectedPersistedSubtitle = availableSubtitles.find(
    (subtitle) => subtitle.id === activeSubtitleId && !subtitle.cues?.length,
  );
  const selectedPersistedSubtitleId = selectedPersistedSubtitle?.id;
  const selectedPersistedSubtitleUrl = selectedPersistedSubtitle?.url;
  const selectedPersistedSubtitleLoaded = Boolean(
    selectedPersistedSubtitleId && persistedSubtitleCues[selectedPersistedSubtitleId]?.length,
  );

  React.useEffect(() => {
    if (
      !selectedPersistedSubtitleId ||
      !selectedPersistedSubtitleUrl ||
      selectedPersistedSubtitleLoaded
    ) {
      return;
    }

    const controller = new AbortController();
    void fetch(selectedPersistedSubtitleUrl, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Subtitle fetch failed');
        return response.text();
      })
      .then((vttText) => {
        const cues = parseWebVttCues(vttText);
        if (!cues.length) throw new Error('Subtitle file has no valid cues');
        setPersistedSubtitleCues((current) => ({
          ...current,
          [selectedPersistedSubtitleId]: cues,
        }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setConnectionMessage('Kayıtlı altyazı yüklenemedi');
      });

    return () => controller.abort();
  }, [selectedPersistedSubtitleId, selectedPersistedSubtitleLoaded, selectedPersistedSubtitleUrl]);

  // Revoke object URLs on unmount to prevent browser memory leaks
  React.useEffect(() => {
    const urlsToRevoke = createdUrlsRef.current;
    return () => {
      if (audioCompatibilityTimerRef.current) {
        clearTimeout(audioCompatibilityTimerRef.current);
      }
      if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
      if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
      if (sourceErrorRecoveryTimerRef.current) {
        clearTimeout(sourceErrorRecoveryTimerRef.current);
      }
      if (pendingHlsSeekTimerRef.current) {
        clearTimeout(pendingHlsSeekTimerRef.current);
      }
      urlsToRevoke.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke errors
        }
      });
    };
  }, []);

  // Synchronize active subtitle selection with HTML5 native textTracks
  React.useEffect(() => {
    if (!videoRef.current) return;
    const tracks = Array.from(videoRef.current.textTracks);
    tracks.forEach((track, idx) => {
      const sub = nativeSubtitles[idx];
      if (sub && (sub.id === activeSubtitleId || (sub.isDefault && !activeSubtitleId))) {
        // Cue-backed subtitles use the styled HTML overlay inline, but iPhone
        // native fullscreen can only display a showing native text track.
        track.mode = sub.cues?.length && !isNativeVideoFullscreen ? 'hidden' : 'showing';
      } else {
        track.mode = 'disabled';
      }
    });
  }, [activeSubtitleId, isNativeVideoFullscreen, nativeSubtitles, subtitleTrackLoadVersion]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleNativeFullscreenStart = () => {
      // Change the mode synchronously while Safari is entering its native
      // player; waiting for a React render can be too late on some iPhones.
      Array.from(video.textTracks).forEach((track, index) => {
        const subtitle = nativeSubtitles[index];
        track.mode =
          subtitle &&
          (subtitle.id === activeSubtitleId || (subtitle.isDefault && !activeSubtitleId))
            ? 'showing'
            : 'disabled';
      });
      setIsNativeVideoFullscreen(true);
    };
    const handleNativeFullscreenEnd = () => setIsNativeVideoFullscreen(false);
    video.addEventListener('webkitbeginfullscreen', handleNativeFullscreenStart);
    video.addEventListener('webkitendfullscreen', handleNativeFullscreenEnd);

    return () => {
      video.removeEventListener('webkitbeginfullscreen', handleNativeFullscreenStart);
      video.removeEventListener('webkitendfullscreen', handleNativeFullscreenEnd);
    };
  }, [activeSubtitleId, nativeSubtitles]);

  // Native Safari HLS restarts its media timeline at zero after an absolute
  // seek. Keep subtitle cues on that local timeline while preserving the
  // user's live subtitle delay.
  const [delayToast, setDelayToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!videoRef.current) return;
    const timelineOffset = playbackTimelineOffset;

    const tracks = Array.from(videoRef.current.textTracks);
    tracks.forEach((track) => {
      if (track.cues) {
        Array.from(track.cues).forEach((cue) => {
          let originalTimes = originalCueTimesRef.current.get(cue);
          if (!originalTimes) {
            originalTimes = { startTime: cue.startTime, endTime: cue.endTime };
            originalCueTimesRef.current.set(cue, originalTimes);
          }

          const alignedTimes = alignSubtitleCueToPlaybackTimeline(
            originalTimes.startTime,
            originalTimes.endTime,
            timelineOffset,
            subtitleDelay,
          );
          cue.startTime = alignedTimes.startTime;
          cue.endTime = alignedTimes.endTime;
        });
      }
    });
  }, [playbackTimelineOffset, subtitleDelay, subtitleTrackLoadVersion]);

  // Z & X Keyboard Hotkeys for live subtitle delay adjustment
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'z' || e.key === 'Z') {
        const next = parseFloat((subtitleDelay - 0.1).toFixed(1));
        setSubtitleDelay(next);
        setDelayToast(`Altyazı Zamanlaması: ${next > 0 ? `+${next}s` : `${next}s`}`);
      } else if (e.key === 'x' || e.key === 'X') {
        const next = parseFloat((subtitleDelay + 0.1).toFixed(1));
        setSubtitleDelay(next);
        setDelayToast(`Altyazı Zamanlaması: ${next > 0 ? `+${next}s` : `${next}s`}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [subtitleDelay, setSubtitleDelay]);

  // Auto-hide delay toast after 2.5 seconds
  React.useEffect(() => {
    if (!delayToast) return;
    const timer = setTimeout(() => setDelayToast(null), 2500);
    return () => clearTimeout(timer);
  }, [delayToast]);

  // Handle missing video drive file ID gracefully
  React.useEffect(() => {
    if (!targetDriveFileId) {
      setErrorState({
        code: 'STREAM_FAILED',
        message:
          'Bu içerik için bağlı bir Google Drive video dosyası bulunamadı. Lütfen kütüphaneyi yeniden tarayın.',
        isRetryable: false,
      });
    }
  }, [targetDriveFileId]);

  const handleCustomSubtitleUpload = async (file: File) => {
    try {
      const text = await file.text();
      const isSrt = file.name.toLowerCase().endsWith('.srt');
      const vttText = isSrt ? convertSrtToVtt(text) : text;
      const cues = parseWebVttCues(vttText);
      if (!cues.length) throw new Error('Subtitle file has no valid cues');

      const customTrack: SubtitleTrackType = {
        id: `custom_${Date.now()}`,
        language: 'tr',
        label: `${file.name.replace(/\.[^/.]+$/, '')} (Yerel)`,
        isForced: false,
        isHearingImpaired: false,
        isDefault: false,
        cues,
      };

      setCustomSubtitles((prev) => [...prev, customTrack]);
      selectSubtitle(customTrack.id);
    } catch {
      // Subtitle parse error handled silently
    }
  };

  const handleSelectOpenSubtitle = async (fileId: number, label: string, languageCode: string) => {
    const res = await fetch('/api/media/subtitles/opensubtitles/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        mediaId: media.id,
        episodeId: activeEpisodeId,
        label,
        languageCode,
      }),
    });

    if (!res.ok) throw new Error('Download failed');
    const result = (await res.json()) as {
      subtitleTrack: SubtitleTrackType;
      vttContent: string;
    };
    const vttText = result.vttContent;
    const cues = parseWebVttCues(vttText);
    if (!cues.length) throw new Error('Downloaded subtitle has no valid cues');

    const openSubTrack: SubtitleTrackType = {
      ...result.subtitleTrack,
      cues,
    };

    setCustomSubtitles((prev) => [
      ...prev.filter((subtitle) => subtitle.id !== openSubTrack.id),
      openSubTrack,
    ]);
    selectSubtitle(openSubTrack.id);
  };

  const cueStyle = `
    ::cue {
      font-size: ${subtitleFontSize}%;
      background-color: ${subtitleBgColor === 'black' ? 'rgba(0, 0, 0, 0.85)' : 'transparent'};
      text-shadow: ${
        subtitleBgColor === 'shadow'
          ? '2px 2px 4px rgba(0, 0, 0, 0.9), -2px -2px 4px rgba(0, 0, 0, 0.9)'
          : 'none'
      };
      border-radius: 6px;
      padding: 2px 8px;
    }
  `;

  const previousEpisode = currentEpisodeIndex > 0 ? episodes[currentEpisodeIndex - 1] : null;
  const nextEpisode =
    currentEpisodeIndex >= 0 && currentEpisodeIndex < episodes.length - 1
      ? episodes[currentEpisodeIndex + 1]
      : null;

  React.useEffect(() => {
    nextEpisodeDismissedRef.current = false;
    setShowNextEpisodeModal(false);
  }, [episodeId]);

  // Stream URL directly to backend endpoint (ZERO FETCH / ZERO BLOB!)
  const videoSourceUrl = targetDriveFileId
    ? playbackMode === 'hls'
      ? `/api/media/${targetDriveFileId}/hls/index.m3u8?start=${hlsStartOffset}&session=${streamSessionId}`
      : `/api/media/${targetDriveFileId}/stream${
          playbackMode === 'audio'
            ? `?transcode=audio&start=${hlsStartOffset}&session=${streamSessionId}`
            : playbackMode === 'full'
              ? `?transcode=full&quality=${effectiveQuality}&start=${hlsStartOffset}&session=${streamSessionId}`
              : ''
        }`
    : '';

  const reportTelemetry = useCallback(
    (event: 'first-frame' | 'stall' | 'seek-recovery' | 'error', durationMs?: number) => {
      if (!targetDriveFileId) return;
      const browser = isSafari
        ? 'safari'
        : /Chrome|Chromium|CriOS|Edg/i.test(navigator.userAgent)
          ? 'chromium'
          : 'other';
      void fetch('/api/insights/player-telemetry', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: media.id,
          driveFileId: targetDriveFileId,
          browser,
          playbackMode,
          event,
          durationMs,
        }),
      }).catch(() => {
        // QoE measurements must never affect playback.
      });
    },
    [isSafari, media.id, playbackMode, targetDriveFileId],
  );

  React.useEffect(() => {
    sourceStartedAtRef.current = performance.now();
    firstFrameReportedRef.current = false;
    stallStartedAtRef.current = null;
  }, [videoSourceUrl]);

  React.useEffect(() => {
    if (playbackMode !== 'hls' || !targetDriveFileId) return;

    const releaseUrl =
      `/api/media/${targetDriveFileId}/hls/release` +
      `?start=${hlsStartOffset}&session=${streamSessionId}`;
    const releaseStream = () => {
      void fetch(releaseUrl, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      }).catch(() => {
        // The server-side idle timeout remains a fallback for abrupt exits.
      });
    };

    window.addEventListener('pagehide', releaseStream);
    return () => {
      window.removeEventListener('pagehide', releaseStream);
      releaseStream();
    };
  }, [hlsStartOffset, playbackMode, streamSessionId, targetDriveFileId]);

  React.useEffect(() => {
    if (playbackMode !== 'audio' && playbackMode !== 'full') return;

    const releaseStream = () => {
      void fetch(`/api/media/transcode/release?session=${streamSessionId}`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      }).catch(() => {
        // The request close handler remains a fallback for abrupt exits.
      });
    };

    window.addEventListener('pagehide', releaseStream);
    return () => {
      window.removeEventListener('pagehide', releaseStream);
      releaseStream();
    };
  }, [playbackMode, streamSessionId]);

  const handleHlsUnsupported = useCallback(() => {
    setErrorState({
      code: 'STREAM_FAILED',
      message: 'Bu tarayıcı uyumlu HLS oynatmayı desteklemiyor.',
      isRetryable: true,
    });
  }, []);
  const handleFatalHlsError = useCallback(() => {
    setStreamGeneration((generation) => generation + 1);
  }, []);
  useHlsPlayback({
    videoRef,
    sourceUrl: videoSourceUrl,
    active: playbackMode === 'hls' && !isSafari,
    onUnsupported: handleHlsUnsupported,
    onFatalError: handleFatalHlsError,
  });

  React.useLayoutEffect(() => {
    suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
  }, [videoSourceUrl]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || resumeAfterSourceChangeRef.current !== playbackMode) return;

    let cancelled = false;
    const resume = () => {
      if (cancelled || resumeAfterSourceChangeRef.current !== playbackMode) {
        return;
      }

      video.play().catch(() => {
        // Keep listening for the next readiness event.
      });
    };

    video.addEventListener('canplay', resume);
    const resumeTimers = [0, 250, 1_000, 2_500].map((delay) => setTimeout(resume, delay));
    return () => {
      cancelled = true;
      resumeTimers.forEach(clearTimeout);
      video.removeEventListener('canplay', resume);
    };
  }, [playbackMode, videoSourceUrl]);

  // Playback Progress Sync Hook
  const { saveProgress } = usePlaybackProgress({
    mediaItemId: media.id,
    episodeId: activeEpisodeId,
    isPlaying,
    currentTime,
    duration,
  });

  // Check Codec Support & Metadata Loading
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setIsBuffering(false);
    const reportedDuration = videoRef.current.duration;
    setDuration(
      analyzedDuration && analyzedDuration > 0
        ? analyzedDuration
        : Number.isFinite(reportedDuration) && reportedDuration > 0
          ? reportedDuration
          : 0,
    );

    // Codec support check
    const video = videoRef.current;
    if (video.error) {
      setErrorState({
        code: 'STREAM_FAILED',
        message: 'Video akışı başlatılamadı.',
        isRetryable: true,
      });
      return;
    }

    if (recoveryPositionRef.current !== null) {
      const recoveryPosition = recoveryPositionRef.current;
      recoveryPositionRef.current = null;
      video.currentTime = useTranscode
        ? Math.max(0, recoveryPosition - hlsStartOffset)
        : recoveryPosition;
      video.play().catch(() => {});
      return;
    }

    // Check if saved resume position exists (> 15s and not completed)
    const savedPos = activeProgress?.positionSeconds || 0;
    const isCompleted = activeProgress?.completed;

    const shouldOfferResume =
      !resumePromptHandledRef.current &&
      !isCompleted &&
      savedPos > 15 &&
      savedPos < (analyzedDuration || video.duration) - 30;
    resumePromptHandledRef.current = true;

    if (shouldOfferResume) {
      video.pause();
      setShowResumeModal(true);
    } else {
      video.play().catch(() => {});
    }
  };

  const clearAudioCompatibilityCheck = useCallback(() => {
    if (audioCompatibilityTimerRef.current) {
      clearTimeout(audioCompatibilityTimerRef.current);
      audioCompatibilityTimerRef.current = null;
    }
  }, []);

  const checkForUnsupportedAudio = useCallback(() => {
    clearAudioCompatibilityCheck();
    if (useTranscode || isMuted || volume === 0) return;

    audioCompatibilityTimerRef.current = setTimeout(() => {
      const video = videoRef.current as
        (HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) | null;

      // Chromium can play the video track of AC-3/E-AC-3/DTS files without
      // raising a media error. In that state the picture advances but no audio
      // frames are decoded, so the normal onError fallback never runs.
      if (
        video &&
        !video.paused &&
        video.currentTime > 3 &&
        typeof video.webkitAudioDecodedByteCount === 'number' &&
        video.webkitAudioDecodedByteCount === 0
      ) {
        suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
        resumeAfterSourceChangeRef.current = 'audio';
        setHlsStartOffset(Math.floor(currentTime));
        setPlaybackMode('audio');
      }
    }, 6000);
  }, [clearAudioCompatibilityCheck, currentTime, isMuted, useTranscode, volume]);

  const seekToAbsoluteTime = useCallback(
    (requestedTime: number, shouldPlay = true, forceSourceReload = false) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(requestedTime)) return;
      const targetTime = Math.max(
        0,
        duration > 0 ? Math.min(duration, requestedTime) : requestedTime,
      );
      seekStartedAtRef.current = performance.now();

      if (playbackMode === 'direct') {
        if (pendingHlsSeekTimerRef.current) {
          clearTimeout(pendingHlsSeekTimerRef.current);
          pendingHlsSeekTimerRef.current = null;
        }
        video.currentTime = targetTime;
        if (shouldPlay) video.play().catch(() => {});
        return;
      }

      const localTarget = targetTime - hlsStartOffset;
      let isInCurrentWindow = false;
      if (playbackMode === 'hls') {
        for (let index = 0; index < video.seekable.length; index++) {
          if (
            localTarget >= video.seekable.start(index) &&
            localTarget <= video.seekable.end(index)
          ) {
            isInCurrentWindow = true;
            break;
          }
        }
      }

      if (isInCurrentWindow && !forceSourceReload) {
        if (pendingHlsSeekTimerRef.current) {
          clearTimeout(pendingHlsSeekTimerRef.current);
          pendingHlsSeekTimerRef.current = null;
        }
        video.currentTime = localTarget;
        if (shouldPlay) video.play().catch(() => {});
        return;
      }

      const nextOffset = Math.floor(targetTime);
      suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
      // Resume the mode that is actually being reloaded. Using a fixed HLS
      // marker leaves audio/full compatibility streams paused at local 0.
      resumeAfterSourceChangeRef.current = shouldPlay ? playbackMode : null;
      setCurrentTime(targetTime);
      setBufferedTime(targetTime);
      setIsBuffering(true);
      setConnectionMessage(
        `${Math.floor(targetTime / 60)}:${String(Math.floor(targetTime % 60)).padStart(2, '0')} konumundan akış hazırlanıyor`,
      );
      if (pendingHlsSeekTimerRef.current) {
        clearTimeout(pendingHlsSeekTimerRef.current);
      }
      pendingHlsSeekTimerRef.current = setTimeout(() => {
        pendingHlsSeekTimerRef.current = null;
        if (nextOffset === hlsStartOffset) {
          video.load();
        } else {
          setHlsStartOffset(nextOffset);
        }
      }, HLS_SEEK_DEBOUNCE_MS);
    },
    [duration, hlsStartOffset, playbackMode],
  );

  const handleResumeClick = () => {
    if (activeProgress?.positionSeconds) {
      seekToAbsoluteTime(activeProgress.positionSeconds, true, playbackMode !== 'direct');
    }
    setShowResumeModal(false);
  };

  const handleRestartClick = () => {
    seekToAbsoluteTime(0);
    setShowResumeModal(false);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const localPlaybackTime = videoRef.current.currentTime;
    const playbackPosition = localPlaybackTime + playbackTimelineOffset;
    setCurrentTime(playbackPosition);

    // Safari can emit a transient waiting/stalled event while it still has a
    // healthy forward buffer, and may not emit a matching playing event.
    // Advancing media time is authoritative proof that playback is not stuck.
    if (!videoRef.current.paused && localPlaybackTime > lastTimeUpdateRef.current + 0.01) {
      setIsBuffering(false);
      setConnectionMessage(null);
      if (stallRecoveryTimerRef.current) {
        clearTimeout(stallRecoveryTimerRef.current);
        stallRecoveryTimerRef.current = null;
      }
    }
    lastTimeUpdateRef.current = localPlaybackTime;

    // Calculate buffered range
    if (videoRef.current.buffered.length > 0) {
      setBufferedTime(
        videoRef.current.buffered.end(videoRef.current.buffered.length - 1) +
          playbackTimelineOffset,
      );
    }

    const reportedDuration = analyzedDuration || videoRef.current.duration;
    if (!Number.isFinite(reportedDuration) || reportedDuration <= 0) return;
    if (Date.now() < suppressNextEpisodeUntilRef.current) return;

    // Trigger next episode overlay when 15s remaining or 94% completion
    if (
      !Number.isFinite(playbackPosition) ||
      playbackPosition < 30 ||
      playbackPosition > reportedDuration + 1
    ) {
      return;
    }

    const remainingSeconds = reportedDuration - playbackPosition;
    const percentage = (playbackPosition / reportedDuration) * 100;
    const isNearEnd =
      (remainingSeconds >= 0 && remainingSeconds <= 15) || (percentage >= 94 && percentage <= 100);
    if (isNearEnd && !showNextEpisodeModal && !nextEpisodeDismissedRef.current && nextEpisode) {
      saveProgress(true);
      if (autoPlayNext) {
        setShowNextEpisodeModal(true);
      }
    }
  };

  const updateBufferedTime = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0) return;

    for (let index = 0; index < video.buffered.length; index++) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (video.currentTime >= start && video.currentTime <= end) {
        setBufferedTime(end + playbackTimelineOffset);
        return;
      }
    }
  }, [playbackTimelineOffset]);

  const clearStallRecoveryTimer = useCallback(() => {
    if (!stallRecoveryTimerRef.current) return;
    clearTimeout(stallRecoveryTimerRef.current);
    stallRecoveryTimerRef.current = null;
  }, []);

  const handleWaiting = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;

    // `stalled` describes network activity, not necessarily exhausted media.
    // Safari frequently reports it with tens of seconds still playable.
    if (getBufferedAheadSeconds(video) >= 1) {
      setIsBuffering(false);
      clearStallRecoveryTimer();
      return;
    }

    if (stallStartedAtRef.current === null) {
      stallStartedAtRef.current = performance.now();
    }
    setIsBuffering(true);
    clearStallRecoveryTimer();

    if (playbackMode === 'full' && qualityPreference === 'auto') {
      stallRecoveryTimerRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (!video || video.paused) return;

        const nextQuality =
          effectiveQuality === 'original' || effectiveQuality === '1080p'
            ? '720p'
            : effectiveQuality === '720p'
              ? '480p'
              : null;
        if (video.currentTime >= 10 || !nextQuality) {
          recoveryPositionRef.current = video.currentTime + playbackTimelineOffset;
          setHlsStartOffset(Math.floor(recoveryPositionRef.current));
          setStreamGeneration((generation) => generation + 1);
          setConnectionMessage('Akış yeniden bağlanıyor');
          return;
        }

        suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
        setConnectionMessage(`Başlangıç akışı ${nextQuality} kalitesinde yeniden hazırlanıyor`);
        setAdaptiveQuality(nextQuality);
      }, STALL_RECOVERY_DELAY_MS);
      return;
    }

    if (playbackMode === 'full' || playbackMode === 'audio') {
      stallRecoveryTimerRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (
          !video ||
          video.paused ||
          stallRecoveryAttemptsRef.current >= MAX_STALL_RECOVERY_ATTEMPTS
        ) {
          return;
        }
        stallRecoveryAttemptsRef.current += 1;
        recoveryPositionRef.current = video.currentTime + playbackTimelineOffset;
        setHlsStartOffset(Math.floor(recoveryPositionRef.current));
        setStreamGeneration((generation) => generation + 1);
        setConnectionMessage(
          `Akış yeniden bağlanıyor (${stallRecoveryAttemptsRef.current}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
        );
      }, STALL_RECOVERY_DELAY_MS);
      return;
    }

    if (playbackMode !== 'direct' && playbackMode !== 'hls') return;

    stallRecoveryTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (
        !video ||
        video.paused ||
        stallRecoveryAttemptsRef.current >= MAX_STALL_RECOVERY_ATTEMPTS
      ) {
        return;
      }

      stallRecoveryAttemptsRef.current += 1;
      recoveryPositionRef.current = video.currentTime + playbackTimelineOffset;
      setConnectionMessage(
        `Bağlantı yeniden kuruluyor (${stallRecoveryAttemptsRef.current}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
      );
      video.load();
    }, STALL_RECOVERY_DELAY_MS);
  }, [
    clearStallRecoveryTimer,
    effectiveQuality,
    playbackMode,
    playbackTimelineOffset,
    qualityPreference,
  ]);

  const handleStalled = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || getBufferedAheadSeconds(video) >= 1) {
      setIsBuffering(false);
      clearStallRecoveryTimer();
      return;
    }
    handleWaiting();
  }, [clearStallRecoveryTimer, handleWaiting]);

  const handlePlaying = useCallback(() => {
    const now = performance.now();
    if (!firstFrameReportedRef.current) {
      firstFrameReportedRef.current = true;
      reportTelemetry('first-frame', now - sourceStartedAtRef.current);
    }
    if (stallStartedAtRef.current !== null) {
      reportTelemetry('stall', now - stallStartedAtRef.current);
      stallStartedAtRef.current = null;
    }
    if (seekStartedAtRef.current !== null) {
      reportTelemetry('seek-recovery', now - seekStartedAtRef.current);
      seekStartedAtRef.current = null;
    }
    if (resumeAfterSourceChangeRef.current === playbackMode) {
      resumeAfterSourceChangeRef.current = null;
    }
    setIsBuffering(false);
    setConnectionMessage(null);
    sourceErrorRecoveryAttemptsRef.current = 0;
    clearStallRecoveryTimer();

    if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
    stablePlaybackTimerRef.current = setTimeout(() => {
      stallRecoveryAttemptsRef.current = 0;
    }, 30_000);
  }, [clearStallRecoveryTimer, playbackMode, reportTelemetry]);

  const handleCanPlayReady = useCallback(() => {
    setIsBuffering(false);
    clearStallRecoveryTimer();
  }, [clearStallRecoveryTimer]);

  const handleVideoEnded = () => {
    const video = videoRef.current;
    const reportedDuration = analyzedDuration || duration || video?.duration || 0;
    const playbackPosition = (video?.currentTime || 0) + playbackTimelineOffset;
    if (
      Date.now() < suppressNextEpisodeUntilRef.current ||
      !Number.isFinite(reportedDuration) ||
      reportedDuration <= 0 ||
      !Number.isFinite(playbackPosition) ||
      playbackPosition < reportedDuration - 15
    ) {
      return;
    }

    saveProgress(true);
    if (nextEpisode && autoPlayNext && !nextEpisodeDismissedRef.current) {
      setShowNextEpisodeModal(true);
    }
  };

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch((err) => {
        if (err.name === 'NotSupportedError') {
          setErrorState({
            code: 'CODEC_NOT_SUPPORTED',
            message: 'Bu videonun biçimi tarayıcınız tarafından doğrudan desteklenmiyor.',
            isRetryable: false,
          });
        }
      });
    }
  }, [isPlaying]);

  const skipBackward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    seekToAbsoluteTime(video.currentTime + playbackTimelineOffset - 10);
  }, [playbackTimelineOffset, seekToAbsoluteTime]);

  const skipForward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    seekToAbsoluteTime(video.currentTime + playbackTimelineOffset + 10);
  }, [playbackTimelineOffset, seekToAbsoluteTime]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted, setIsMuted]);

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current;
    const container = playerContainerRef.current;
    if (!video || !container) return;

    setFullscreenError(null);
    void togglePlayerFullscreen(video, container).catch(() => {
      setFullscreenError('Bu tarayıcı tam ekran video oynatmayı desteklemiyor.');
    });
  }, []);

  const togglePiP = useCallback(() => {
    if (!videoRef.current) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else {
      videoRef.current.requestPictureInPicture();
    }
  }, []);

  // Keyboard Shortcuts Hook
  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onSkipBackward: skipBackward,
    onSkipForward: skipForward,
    onVolumeUp: () => {
      const newVol = Math.min(1, volume + 0.1);
      setVolume(newVol);
      if (videoRef.current) videoRef.current.volume = newVol;
    },
    onVolumeDown: () => {
      const newVol = Math.max(0, volume - 0.1);
      setVolume(newVol);
      if (videoRef.current) videoRef.current.volume = newVol;
    },
    onToggleMute: toggleMute,
    onToggleFullscreen: toggleFullscreen,
    onTogglePiP: togglePiP,
    onToggleSubtitles: () => {
      const firstSub = availableSubtitles[0];
      selectSubtitle(activeSubtitleId ? null : firstSub ? firstSub.id : null);
    },
    onSeekPercent: (percent) => {
      if (duration > 0) seekToAbsoluteTime((percent / 100) * duration);
    },
    onCloseMenu: () => {
      if (document.fullscreenElement) document.exitFullscreen();
    },
  });

  const handleEpisodeChange = (newEpId: string) => {
    saveProgress(true);
    navigate(`/watch/${media.id}/${newEpId}`);
  };

  const handleRetry = () => {
    setErrorState(null);
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  };

  return (
    <div
      ref={playerContainerRef}
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] min-h-[100svh] w-screen select-none flex-col justify-between overflow-hidden bg-black"
    >
      <style>{cueStyle}</style>

      {/* Top Navigation Header Bar */}
      <div
        className={`absolute inset-x-0 top-0 z-30 flex items-center gap-3 bg-gradient-to-b from-black/90 via-black/40 to-transparent px-3 pb-8 pt-[calc(env(safe-area-inset-top)+0.75rem)] transition-opacity duration-300 sm:gap-4 sm:p-6 ${
          areControlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          onClick={() => {
            saveProgress(true);
            navigate(`/media/${media.id}`);
          }}
          className="rounded-full bg-zinc-900/80 p-2.5 text-white backdrop-blur-md transition-colors hover:bg-zinc-800 sm:p-3"
          aria-label="Geri Dön"
        >
          <ArrowLeft className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
        <h2 className="truncate font-display text-base font-bold text-white sm:text-lg">
          {titleDisplay}
        </h2>
      </div>

      {/* Buffering Center Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-6 py-5 backdrop-blur-md">
            <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
            <span className="text-xs font-semibold text-zinc-300">
              {connectionMessage || 'Akış tamponlanıyor…'}
            </span>
          </div>
        </div>
      )}

      {/* HTML5 Native Video Stream Element with Subtitle Tracks */}
      <video
        ref={videoRef}
        src={playbackMode === 'hls' && !isSafari ? undefined : videoSourceUrl}
        onPlay={() => {
          setIsPlaying(true);
          checkForUnsupportedAudio();
        }}
        onPause={() => {
          setIsPlaying(false);
          clearAudioCompatibilityCheck();
        }}
        onWaiting={handleWaiting}
        onStalled={handleStalled}
        onPlaying={handlePlaying}
        onCanPlay={handleCanPlayReady}
        onProgress={updateBufferedTime}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleVideoEnded}
        onError={() => {
          reportTelemetry('error');
          // Safari reports unsupported containers/codecs as a generic media
          // error. Retry once with full H.264/AAC compatibility transcoding;
          // if that also fails, show the actionable player error.
          if (playbackMode === 'direct' || playbackMode === 'audio') {
            const fallbackMode: PlaybackMode = isSafari ? 'hls' : 'full';
            suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
            resumeAfterSourceChangeRef.current = isPlaying ? fallbackMode : null;
            setHlsStartOffset(Math.floor(currentTime));
            setErrorState(null);
            setPlaybackMode(fallbackMode);
            return;
          }

          if (playbackMode === 'hls' && sourceErrorRecoveryAttemptsRef.current < 2) {
            sourceErrorRecoveryAttemptsRef.current += 1;
            setErrorState(null);
            setIsBuffering(true);
            setConnectionMessage(
              `Mobil akış yeniden deneniyor (${sourceErrorRecoveryAttemptsRef.current}/2)`,
            );
            if (sourceErrorRecoveryTimerRef.current) {
              clearTimeout(sourceErrorRecoveryTimerRef.current);
            }
            sourceErrorRecoveryTimerRef.current = setTimeout(() => {
              const video = videoRef.current;
              if (!video) return;
              if (playbackMode === 'hls' && !isSafari) {
                setStreamGeneration((generation) => generation + 1);
              } else {
                video.load();
              }
              void video.play().catch(() => {
                // The retry remains loaded and can still be resumed manually
                // when the browser requires a fresh user gesture.
              });
            }, 1_200);
            return;
          }

          setErrorState({
            code: 'STREAM_FAILED',
            message: 'Video akışı sunucudan alınırken hata oluştu.',
            isRetryable: true,
          });
        }}
        onClick={togglePlay}
        className={`w-full h-full object-contain cursor-pointer transition-all duration-500 ${
          cinemaMode
            ? 'scale-[0.94] rounded-2xl shadow-[0_0_100px_rgba(245,158,11,0.2)] border border-amber-500/20'
            : ''
        }`}
        playsInline
      >
        {nativeSubtitles.map((sub) => (
          <track
            key={sub.id}
            src={getNativeSubtitleSource(sub)}
            kind="subtitles"
            srcLang={sub.language}
            label={sub.label || (sub.language || 'und').toUpperCase()}
            default={activeSubtitleId === sub.id || (sub.isDefault && !activeSubtitleId)}
            onLoad={() => setSubtitleTrackLoadVersion((version) => version + 1)}
          />
        ))}
      </video>

      {activeOverlayCue && !isNativeVideoFullscreen && (
        <div
          className="pointer-events-none absolute inset-x-4 bottom-36 z-30 flex justify-center text-center sm:bottom-24"
          data-testid="subtitle-overlay"
        >
          <span
            className="whitespace-pre-line rounded-md px-3 py-1.5 font-semibold leading-snug text-white"
            style={{
              fontSize: `${subtitleFontSize}%`,
              backgroundColor: subtitleBgColor === 'black' ? 'rgba(0, 0, 0, 0.85)' : 'transparent',
              textShadow:
                subtitleBgColor === 'shadow'
                  ? '2px 2px 4px rgba(0, 0, 0, 0.95), -2px -2px 4px rgba(0, 0, 0, 0.95)'
                  : 'none',
            }}
          >
            {activeOverlayCue.text}
          </span>
        </div>
      )}

      {/* Subtitle Delay Live Toast Notification Overlay */}
      {delayToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-zinc-950/90 backdrop-blur-md border border-brand-500/40 rounded-2xl text-xs font-bold text-white shadow-2xl animate-fade-in flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-400" />
          <span>{delayToast}</span>
        </div>
      )}

      {fullscreenError && (
        <div
          role="alert"
          className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 -translate-x-1/2 rounded-xl border border-red-500/30 bg-zinc-950/95 px-4 py-2 text-center text-xs font-semibold text-red-300 shadow-2xl"
        >
          {fullscreenError}
        </div>
      )}

      {/* Overlays */}
      {showResumeModal && (
        <ResumeOverlay
          savedPositionSeconds={activeProgress?.positionSeconds || 0}
          onResume={handleResumeClick}
          onRestart={handleRestartClick}
        />
      )}

      {showNextEpisodeModal && nextEpisode && (
        <NextEpisodeOverlay
          nextEpisodeTitle={nextEpisode.title}
          seasonNumber={nextEpisode.seasonNumber}
          episodeNumber={nextEpisode.episodeNumber}
          stillUrl={nextEpisode.stillUrl}
          posterUrl={media.posterUrl}
          overview={nextEpisode.overview}
          onPlayNext={() => {
            setShowNextEpisodeModal(false);
            handleEpisodeChange(nextEpisode.id);
          }}
          onCancel={() => {
            nextEpisodeDismissedRef.current = true;
            setShowNextEpisodeModal(false);
          }}
        />
      )}

      {errorState && (
        <PlayerError
          error={errorState}
          onRetry={handleRetry}
          onEnableTranscode={() => {
            setPlaybackMode(isSafari ? 'hls' : 'audio');
            handleRetry();
          }}
        />
      )}

      {/* Controls Overlay Bar */}
      <div
        className={`transition-opacity duration-300 ${
          areControlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <PlayerControls
          mediaId={media.id}
          previewDriveFileId={targetDriveFileId || undefined}
          seasonNumber={currentSeasonNum}
          episodeNumber={currentEpisodeNum}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          bufferedTime={bufferedTime}
          volume={volume}
          isMuted={isMuted}
          playbackSpeed={playbackSpeed}
          subtitles={resolvedSubtitles}
          activeSubtitleId={activeSubtitleId}
          hasPreviousEpisode={!!previousEpisode}
          hasNextEpisode={!!nextEpisode}
          useTranscode={useTranscode}
          qualityPreference={qualityPreference}
          effectiveQuality={effectiveQuality}
          showQualityControl={playbackMode === 'full'}
          onSelectQuality={(quality) => {
            suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
            setQualityPreference(quality);
            if (quality === 'auto') setAdaptiveQuality(automaticQuality);
            try {
              getQualityStorage()?.setItem(QUALITY_STORAGE_KEY, quality);
            } catch {
              // The preference remains valid for the current session.
            }
          }}
          onToggleTranscode={() => {
            const video = videoRef.current;
            const compatibilityMode: PlaybackMode =
              recommendedPlaybackMode === 'direct'
                ? isSafari
                  ? 'hls'
                  : 'audio'
                : recommendedPlaybackMode;
            const nextMode: PlaybackMode =
              playbackMode === compatibilityMode ? 'direct' : compatibilityMode;
            suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
            resumeAfterSourceChangeRef.current =
              isPlaying || Boolean(video && !video.paused) ? nextMode : null;
            if (nextMode !== 'direct') {
              setHlsStartOffset(Math.floor(currentTime));
            } else if (playbackMode !== 'direct') {
              recoveryPositionRef.current = currentTime;
              setHlsStartOffset(0);
            }
            setPlaybackMode(nextMode);
          }}
          onTogglePlay={togglePlay}
          onSkipBackward={skipBackward}
          onSkipForward={skipForward}
          onSeek={seekToAbsoluteTime}
          onVolumeChange={(vol) => {
            setVolume(vol);
            if (videoRef.current) videoRef.current.volume = vol;
          }}
          onToggleMute={toggleMute}
          onSelectSpeed={(speed) => {
            setPlaybackSpeed(speed);
            if (videoRef.current) videoRef.current.playbackRate = speed;
          }}
          onSelectSubtitle={selectSubtitle}
          onUploadCustomSubtitle={handleCustomSubtitleUpload}
          onSelectOpenSubtitle={handleSelectOpenSubtitle}
          onTogglePiP={togglePiP}
          onToggleFullscreen={toggleFullscreen}
          onPreviousEpisode={
            previousEpisode ? () => handleEpisodeChange(previousEpisode.id) : undefined
          }
          onNextEpisode={nextEpisode ? () => handleEpisodeChange(nextEpisode.id) : undefined}
        />
      </div>
    </div>
  );
};

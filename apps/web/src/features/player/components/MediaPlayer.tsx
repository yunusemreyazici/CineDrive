import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useActiveMedia } from '../hooks/useActiveMedia';
import { usePlaybackSource } from '../hooks/usePlaybackSource';
import { useSubtitleTracks } from '../hooks/useSubtitleTracks';
import { usePlayerTelemetry } from '../hooks/usePlayerTelemetry';
import {
  getBufferedAheadSeconds,
  isSafariBrowser,
  togglePlayerFullscreen,
} from '../utils/playerBrowser';
import {
  alignSubtitleCueToPlaybackTimeline,
  getNativeSubtitleSource,
} from '../utils/subtitleTracks';
import { findActiveSubtitleCue } from '../utils/subtitleCues';
import type { PlayerErrorState, SubtitleTrackType } from '../types/player';
import type { MediaItemType, PlaybackMode } from '../../../types/media';

interface MediaPlayerProps {
  media: MediaItemType;
  episodeId?: string;
}

const STALL_RECOVERY_DELAY_MS = 12_000;
const MAX_STALL_RECOVERY_ATTEMPTS = 2;
const MAX_SOURCE_ERROR_RETRIES = 2;
const HLS_SEEK_DEBOUNCE_MS = 400;
/** After any source change, ignore end-of-media heuristics for this long. */
const NEXT_EPISODE_SUPPRESSION_MS = 20_000;
const AUDIO_COMPATIBILITY_PROBE_MS = 6000;
const STABLE_PLAYBACK_RESET_MS = 30_000;

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ media, episodeId }) => {
  const navigate = useNavigate();
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSafari = isSafariBrowser();

  const {
    volume,
    isMuted,
    playbackSpeed,
    autoPlayNext,
    subtitleDelay,
    subtitleFontSize,
    subtitleBgColor,
    setVolume,
    setIsMuted,
    setPlaybackSpeed,
    setSubtitleDelay,
  } = usePlayerStore();
  const cinemaMode = useUiStore((state) => state.cinemaMode);

  const active = useActiveMedia(media, episodeId);
  const recommendedMode: PlaybackMode = isSafari
    ? active.playbackPlan?.safari || 'direct'
    : active.playbackPlan?.chromium || 'direct';

  const source = usePlaybackSource({
    driveFileId: active.driveFileId,
    recommendedMode,
    sourceHeight: active.analyzedHeight,
  });
  const { dispatch: dispatchSource, timelineOffset, useTranscode } = source;

  // --- Timers and cross-render bookkeeping -------------------------------
  const audioCompatibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stablePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceErrorRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallRecoveryAttemptsRef = useRef(0);
  const sourceErrorRecoveryAttemptsRef = useRef(0);
  const recoveryPositionRef = useRef<number | null>(null);
  const resumeAfterSourceChangeRef = useRef<PlaybackMode | null>(null);
  const resumePromptHandledRef = useRef(false);
  const suppressNextEpisodeUntilRef = useRef(0);
  const sourceStartedAtRef = useRef(0);
  const firstFrameReportedRef = useRef(false);
  const stallStartedAtRef = useRef<number | null>(null);
  const seekStartedAtRef = useRef<number | null>(null);
  const lastTimeUpdateRef = useRef(0);
  const nextEpisodeDismissedRef = useRef(false);
  const originalCueTimesRef = useRef(
    new WeakMap<TextTrackCue, { startTime: number; endTime: number }>(),
  );

  // --- Local playback state ----------------------------------------------
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showNextEpisodeModal, setShowNextEpisodeModal] = useState(false);
  const [errorState, setErrorState] = useState<PlayerErrorState | null>(null);
  const [isNativeVideoFullscreen, setIsNativeVideoFullscreen] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [delayToast, setDelayToast] = useState<string | null>(null);

  const { areControlsVisible, resetHideTimer } = usePlayerControls(isPlaying);

  const handleSubtitleLoadError = useCallback(
    (message: string) => setConnectionMessage(message),
    [],
  );
  const subtitles = useSubtitleTracks({
    ownerId: active.activeEpisodeId || media.id,
    serverSubtitles: active.subtitles,
    onLoadError: handleSubtitleLoadError,
  });
  const {
    activeSubtitleId,
    availableSubtitles,
    resolvedSubtitles,
    trackLoadVersion,
    markTrackLoaded,
    selectSubtitle,
  } = subtitles;

  const reportTelemetry = usePlayerTelemetry({
    mediaId: media.id,
    driveFileId: active.driveFileId,
    isSafari,
    playbackMode: source.playbackMode,
    sessionId: source.sessionId,
    startOffset: source.startOffset,
  });

  const { saveProgress } = usePlaybackProgress({
    mediaItemId: media.id,
    episodeId: active.activeEpisodeId,
    isPlaying,
    currentTime,
    duration,
  });

  // iPhone Safari shows only the native video layer in fullscreen, so every
  // subtitle source stays a real text track.
  const activeOverlaySubtitle = resolvedSubtitles.find(
    (subtitle) =>
      subtitle.cues?.length &&
      (subtitle.id === activeSubtitleId || (subtitle.isDefault && !activeSubtitleId)),
  );
  const activeOverlayCue = activeOverlaySubtitle?.cues
    ? findActiveSubtitleCue(activeOverlaySubtitle.cues, currentTime, subtitleDelay)
    : undefined;

  const suppressNextEpisode = useCallback(() => {
    suppressNextEpisodeUntilRef.current = Date.now() + NEXT_EPISODE_SUPPRESSION_MS;
  }, []);

  const clearTimer = (ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (!ref.current) return;
    clearTimeout(ref.current);
    ref.current = null;
  };

  // --- Source lifecycle ---------------------------------------------------
  useEffect(() => {
    clearTimer(pendingSeekTimerRef);
    dispatchSource({
      type: 'reset',
      playbackMode: recommendedMode,
      adaptiveQuality: source.automaticQuality,
    });
    resumePromptHandledRef.current = false;
    stallRecoveryAttemptsRef.current = 0;
    sourceErrorRecoveryAttemptsRef.current = 0;
    recoveryPositionRef.current = null;
    setShowResumeModal(false);
    setErrorState(null);
    setConnectionMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the file or its recommended strategy changes
  }, [active.driveFileId, recommendedMode, source.automaticQuality]);

  useEffect(() => {
    nextEpisodeDismissedRef.current = false;
    setShowNextEpisodeModal(false);
  }, [episodeId]);

  useLayoutEffect(() => {
    suppressNextEpisode();
    sourceStartedAtRef.current = performance.now();
    firstFrameReportedRef.current = false;
    stallStartedAtRef.current = null;
  }, [source.sourceUrl, suppressNextEpisode]);

  useEffect(() => {
    if (active.driveFileId) return;
    setErrorState({
      code: 'STREAM_FAILED',
      message:
        'Bu içerik için bağlı bir Google Drive video dosyası bulunamadı. Lütfen kütüphaneyi yeniden tarayın.',
      isRetryable: false,
    });
  }, [active.driveFileId]);

  // Clean up every pending timer on unmount.
  useEffect(
    () => () => {
      clearTimer(audioCompatibilityTimerRef);
      clearTimer(stallRecoveryTimerRef);
      clearTimer(stablePlaybackTimerRef);
      clearTimer(sourceErrorRecoveryTimerRef);
      clearTimer(pendingSeekTimerRef);
    },
    [],
  );

  const handleHlsUnsupported = useCallback(() => {
    setErrorState({
      code: 'STREAM_FAILED',
      message: 'Bu tarayıcı uyumlu HLS oynatmayı desteklemiyor.',
      isRetryable: true,
    });
  }, []);
  const handleFatalHlsError = useCallback(
    () => dispatchSource({ type: 'restart' }),
    [dispatchSource],
  );
  useHlsPlayback({
    videoRef,
    sourceUrl: source.sourceUrl,
    active: source.playbackMode === 'hls' && !isSafari,
    onUnsupported: handleHlsUnsupported,
    onFatalError: handleFatalHlsError,
  });

  // Autoplay again once a replacement source is ready, if we were playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || resumeAfterSourceChangeRef.current !== source.playbackMode) return;

    let cancelled = false;
    const resume = () => {
      if (cancelled || resumeAfterSourceChangeRef.current !== source.playbackMode) return;
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
  }, [source.playbackMode, source.sourceUrl]);

  // --- Subtitles ----------------------------------------------------------
  useEffect(() => {
    if (!videoRef.current) return;
    Array.from(videoRef.current.textTracks).forEach((track, index) => {
      const subtitle = resolvedSubtitles[index];
      if (subtitle && (subtitle.id === activeSubtitleId || (subtitle.isDefault && !activeSubtitleId))) {
        // Cue-backed subtitles use the styled HTML overlay inline, but iPhone
        // native fullscreen can only display a showing native text track.
        track.mode = subtitle.cues?.length && !isNativeVideoFullscreen ? 'hidden' : 'showing';
      } else {
        track.mode = 'disabled';
      }
    });
  }, [activeSubtitleId, isNativeVideoFullscreen, resolvedSubtitles, trackLoadVersion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleNativeFullscreenStart = () => {
      // Change the mode synchronously while Safari is entering its native
      // player; waiting for a React render can be too late on some iPhones.
      Array.from(video.textTracks).forEach((track, index) => {
        const subtitle = resolvedSubtitles[index];
        track.mode =
          subtitle && (subtitle.id === activeSubtitleId || (subtitle.isDefault && !activeSubtitleId))
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
  }, [activeSubtitleId, resolvedSubtitles]);

  // Native Safari HLS restarts its media timeline at zero after an absolute
  // seek. Keep native cues on that local timeline, preserving the live delay.
  useEffect(() => {
    if (!videoRef.current) return;

    Array.from(videoRef.current.textTracks).forEach((track) => {
      if (!track.cues) return;
      Array.from(track.cues).forEach((cue) => {
        let originalTimes = originalCueTimesRef.current.get(cue);
        if (!originalTimes) {
          originalTimes = { startTime: cue.startTime, endTime: cue.endTime };
          originalCueTimesRef.current.set(cue, originalTimes);
        }

        const aligned = alignSubtitleCueToPlaybackTimeline(
          originalTimes.startTime,
          originalTimes.endTime,
          timelineOffset,
          subtitleDelay,
        );
        cue.startTime = aligned.startTime;
        cue.endTime = aligned.endTime;
      });
    });
  }, [subtitleDelay, timelineOffset, trackLoadVersion]);

  // Z & X adjust the subtitle delay live.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'x') return;

      const next = parseFloat((subtitleDelay + (key === 'z' ? -0.1 : 0.1)).toFixed(1));
      setSubtitleDelay(next);
      setDelayToast(`Altyazı Zamanlaması: ${next > 0 ? `+${next}s` : `${next}s`}`);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSubtitleDelay, subtitleDelay]);

  useEffect(() => {
    if (!delayToast) return;
    const timer = setTimeout(() => setDelayToast(null), 2500);
    return () => clearTimeout(timer);
  }, [delayToast]);

  const handleSelectOpenSubtitle = useCallback(
    async (fileId: number, label: string, languageCode: string) => {
      const res = await fetch('/api/media/subtitles/opensubtitles/download', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          mediaId: media.id,
          episodeId: active.activeEpisodeId,
          label,
          languageCode,
        }),
      });

      if (!res.ok) throw new Error('Download failed');
      const result = (await res.json()) as {
        subtitleTrack: SubtitleTrackType;
        vttContent: string;
      };
      subtitles.addDownloadedSubtitle(result.subtitleTrack, result.vttContent);
    },
    [active.activeEpisodeId, media.id, subtitles],
  );

  // --- Seeking ------------------------------------------------------------
  const seekToAbsoluteTime = useCallback(
    (requestedTime: number, shouldPlay = true, forceSourceReload = false) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(requestedTime)) return;

      const targetTime = Math.max(
        0,
        duration > 0 ? Math.min(duration, requestedTime) : requestedTime,
      );
      seekStartedAtRef.current = performance.now();

      if (source.playbackMode === 'direct') {
        clearTimer(pendingSeekTimerRef);
        video.currentTime = targetTime;
        if (shouldPlay) video.play().catch(() => {});
        return;
      }

      // A transcoded stream can only seek inside the window it has produced;
      // anything else needs a new job starting at the target position.
      const localTarget = targetTime - source.startOffset;
      let isInCurrentWindow = false;
      if (source.playbackMode === 'hls') {
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
        clearTimer(pendingSeekTimerRef);
        video.currentTime = localTarget;
        if (shouldPlay) video.play().catch(() => {});
        return;
      }

      suppressNextEpisode();
      // Resume the mode that is actually being reloaded. Using a fixed HLS
      // marker leaves audio/full compatibility streams paused at local 0.
      resumeAfterSourceChangeRef.current = shouldPlay ? source.playbackMode : null;
      setCurrentTime(targetTime);
      setBufferedTime(targetTime);
      setIsBuffering(true);
      setConnectionMessage(
        `${Math.floor(targetTime / 60)}:${String(Math.floor(targetTime % 60)).padStart(2, '0')} konumundan akış hazırlanıyor`,
      );

      clearTimer(pendingSeekTimerRef);
      pendingSeekTimerRef.current = setTimeout(() => {
        pendingSeekTimerRef.current = null;
        dispatchSource({ type: 'seekTo', offsetSeconds: Math.floor(targetTime) });
      }, HLS_SEEK_DEBOUNCE_MS);
    },
    [dispatchSource, duration, source.playbackMode, source.startOffset, suppressNextEpisode],
  );

  // --- Media element event handlers ---------------------------------------
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setIsBuffering(false);
    const reportedDuration = video.duration;
    setDuration(
      active.analyzedDuration && active.analyzedDuration > 0
        ? active.analyzedDuration
        : Number.isFinite(reportedDuration) && reportedDuration > 0
          ? reportedDuration
          : 0,
    );

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
        ? Math.max(0, recoveryPosition - source.startOffset)
        : recoveryPosition;
      video.play().catch(() => {});
      return;
    }

    const savedPosition = active.progress?.positionSeconds || 0;
    const shouldOfferResume =
      !resumePromptHandledRef.current &&
      !active.progress?.completed &&
      savedPosition > 15 &&
      savedPosition < (active.analyzedDuration || video.duration) - 30;
    resumePromptHandledRef.current = true;

    if (shouldOfferResume) {
      video.pause();
      setShowResumeModal(true);
    } else {
      video.play().catch(() => {});
    }
  };

  const clearAudioCompatibilityCheck = useCallback(() => {
    clearTimer(audioCompatibilityTimerRef);
  }, []);

  const checkForUnsupportedAudio = useCallback(() => {
    clearAudioCompatibilityCheck();
    if (useTranscode || isMuted || volume === 0) return;

    audioCompatibilityTimerRef.current = setTimeout(() => {
      const video = videoRef.current as
        | (HTMLVideoElement & { webkitAudioDecodedByteCount?: number })
        | null;

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
        suppressNextEpisode();
        resumeAfterSourceChangeRef.current = 'audio';
        dispatchSource({
          type: 'setMode',
          playbackMode: 'audio',
          offsetSeconds: Math.floor(currentTime),
        });
      }
    }, AUDIO_COMPATIBILITY_PROBE_MS);
  }, [
    clearAudioCompatibilityCheck,
    currentTime,
    dispatchSource,
    isMuted,
    suppressNextEpisode,
    useTranscode,
    volume,
  ]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const localPlaybackTime = video.currentTime;
    const playbackPosition = localPlaybackTime + timelineOffset;
    setCurrentTime(playbackPosition);

    // Safari can emit a transient waiting/stalled event while it still has a
    // healthy forward buffer, and may not emit a matching playing event.
    // Advancing media time is authoritative proof that playback is not stuck.
    if (!video.paused && localPlaybackTime > lastTimeUpdateRef.current + 0.01) {
      setIsBuffering(false);
      setConnectionMessage(null);
      clearTimer(stallRecoveryTimerRef);
    }
    lastTimeUpdateRef.current = localPlaybackTime;

    if (video.buffered.length > 0) {
      setBufferedTime(video.buffered.end(video.buffered.length - 1) + timelineOffset);
    }

    const reportedDuration = active.analyzedDuration || video.duration;
    if (!Number.isFinite(reportedDuration) || reportedDuration <= 0) return;
    if (Date.now() < suppressNextEpisodeUntilRef.current) return;
    if (
      !Number.isFinite(playbackPosition) ||
      playbackPosition < 30 ||
      playbackPosition > reportedDuration + 1
    ) {
      return;
    }

    // Offer the next episode with 15s left, or at 94% for files whose reported
    // duration includes credits padding.
    const remainingSeconds = reportedDuration - playbackPosition;
    const percentage = (playbackPosition / reportedDuration) * 100;
    const isNearEnd =
      (remainingSeconds >= 0 && remainingSeconds <= 15) || (percentage >= 94 && percentage <= 100);

    if (isNearEnd && !showNextEpisodeModal && !nextEpisodeDismissedRef.current && active.nextEpisode) {
      saveProgress(true);
      if (autoPlayNext) setShowNextEpisodeModal(true);
    }
  };

  const updateBufferedTime = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0) return;

    for (let index = 0; index < video.buffered.length; index++) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (video.currentTime >= start && video.currentTime <= end) {
        setBufferedTime(end + timelineOffset);
        return;
      }
    }
  }, [timelineOffset]);

  const handleWaiting = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;

    // `stalled` describes network activity, not necessarily exhausted media.
    // Safari frequently reports it with tens of seconds still playable.
    if (getBufferedAheadSeconds(video) >= 1) {
      setIsBuffering(false);
      clearTimer(stallRecoveryTimerRef);
      return;
    }

    if (stallStartedAtRef.current === null) stallStartedAtRef.current = performance.now();
    setIsBuffering(true);
    clearTimer(stallRecoveryTimerRef);

    stallRecoveryTimerRef.current = setTimeout(() => {
      const stalledVideo = videoRef.current;
      if (!stalledVideo || stalledVideo.paused) return;

      // While a transcode is still ramping up, dropping a quality tier is a
      // cheaper fix than restarting the job.
      if (source.playbackMode === 'full' && source.qualityPreference === 'auto') {
        const nextQuality =
          source.effectiveQuality === 'original' || source.effectiveQuality === '1080p'
            ? '720p'
            : source.effectiveQuality === '720p'
              ? '480p'
              : null;

        if (stalledVideo.currentTime < 10 && nextQuality) {
          suppressNextEpisode();
          setConnectionMessage(`Başlangıç akışı ${nextQuality} kalitesinde yeniden hazırlanıyor`);
          dispatchSource({ type: 'setAdaptiveQuality', quality: nextQuality });
          return;
        }

        recoveryPositionRef.current = stalledVideo.currentTime + timelineOffset;
        setConnectionMessage('Akış yeniden bağlanıyor');
        dispatchSource({
          type: 'seekTo',
          offsetSeconds: Math.floor(recoveryPositionRef.current),
        });
        return;
      }

      if (stallRecoveryAttemptsRef.current >= MAX_STALL_RECOVERY_ATTEMPTS) return;
      stallRecoveryAttemptsRef.current += 1;
      recoveryPositionRef.current = stalledVideo.currentTime + timelineOffset;

      if (source.playbackMode === 'audio' || source.playbackMode === 'full') {
        setConnectionMessage(
          `Akış yeniden bağlanıyor (${stallRecoveryAttemptsRef.current}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
        );
        dispatchSource({
          type: 'seekTo',
          offsetSeconds: Math.floor(recoveryPositionRef.current),
        });
        return;
      }

      setConnectionMessage(
        `Bağlantı yeniden kuruluyor (${stallRecoveryAttemptsRef.current}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
      );
      stalledVideo.load();
    }, STALL_RECOVERY_DELAY_MS);
  }, [
    dispatchSource,
    source.effectiveQuality,
    source.playbackMode,
    source.qualityPreference,
    suppressNextEpisode,
    timelineOffset,
  ]);

  const handleStalled = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || getBufferedAheadSeconds(video) >= 1) {
      setIsBuffering(false);
      clearTimer(stallRecoveryTimerRef);
      return;
    }
    handleWaiting();
  }, [handleWaiting]);

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
    if (resumeAfterSourceChangeRef.current === source.playbackMode) {
      resumeAfterSourceChangeRef.current = null;
    }

    setIsBuffering(false);
    setConnectionMessage(null);
    sourceErrorRecoveryAttemptsRef.current = 0;
    clearTimer(stallRecoveryTimerRef);

    // Only forgive earlier stall attempts once playback has actually held.
    clearTimer(stablePlaybackTimerRef);
    stablePlaybackTimerRef.current = setTimeout(() => {
      stallRecoveryAttemptsRef.current = 0;
    }, STABLE_PLAYBACK_RESET_MS);
  }, [reportTelemetry, source.playbackMode]);

  const handleCanPlayReady = useCallback(() => {
    setIsBuffering(false);
    clearTimer(stallRecoveryTimerRef);
  }, []);

  const handleSourceError = useCallback(() => {
    reportTelemetry('error');

    // Safari reports unsupported containers/codecs as a generic media error.
    // Retry once with full H.264/AAC compatibility transcoding; if that also
    // fails, show the actionable player error.
    if (source.playbackMode === 'direct' || source.playbackMode === 'audio') {
      const fallbackMode: PlaybackMode = isSafari ? 'hls' : 'full';
      suppressNextEpisode();
      resumeAfterSourceChangeRef.current = isPlaying ? fallbackMode : null;
      setErrorState(null);
      dispatchSource({
        type: 'setMode',
        playbackMode: fallbackMode,
        offsetSeconds: Math.floor(currentTime),
      });
      return;
    }

    if (
      source.playbackMode === 'hls' &&
      sourceErrorRecoveryAttemptsRef.current < MAX_SOURCE_ERROR_RETRIES
    ) {
      sourceErrorRecoveryAttemptsRef.current += 1;
      setErrorState(null);
      setIsBuffering(true);
      setConnectionMessage(
        `Mobil akış yeniden deneniyor (${sourceErrorRecoveryAttemptsRef.current}/${MAX_SOURCE_ERROR_RETRIES})`,
      );

      clearTimer(sourceErrorRecoveryTimerRef);
      sourceErrorRecoveryTimerRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;
        if (!isSafari) {
          dispatchSource({ type: 'restart' });
        } else {
          video.load();
        }
        void video.play().catch(() => {
          // The retry remains loaded and can still be resumed manually when
          // the browser requires a fresh user gesture.
        });
      }, 1_200);
      return;
    }

    setErrorState({
      code: 'STREAM_FAILED',
      message: 'Video akışı sunucudan alınırken hata oluştu.',
      isRetryable: true,
    });
  }, [
    currentTime,
    dispatchSource,
    isPlaying,
    isSafari,
    reportTelemetry,
    source.playbackMode,
    suppressNextEpisode,
  ]);

  const handleVideoEnded = () => {
    const video = videoRef.current;
    const reportedDuration = active.analyzedDuration || duration || video?.duration || 0;
    const playbackPosition = (video?.currentTime || 0) + timelineOffset;

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
    if (active.nextEpisode && autoPlayNext && !nextEpisodeDismissedRef.current) {
      setShowNextEpisodeModal(true);
    }
  };

  // --- User controls ------------------------------------------------------
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      return;
    }
    video.play().catch((err: Error) => {
      if (err.name !== 'NotSupportedError') return;
      setErrorState({
        code: 'CODEC_NOT_SUPPORTED',
        message: 'Bu videonun biçimi tarayıcınız tarafından doğrudan desteklenmiyor.',
        isRetryable: false,
      });
    });
  }, [isPlaying]);

  const skipBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      seekToAbsoluteTime(video.currentTime + timelineOffset + deltaSeconds);
    },
    [seekToAbsoluteTime, timelineOffset],
  );
  const skipBackward = useCallback(() => skipBy(-10), [skipBy]);
  const skipForward = useCallback(() => skipBy(10), [skipBy]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
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
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture();
    } else {
      void video.requestPictureInPicture();
    }
  }, []);

  const changeVolume = useCallback(
    (nextVolume: number) => {
      const clamped = Math.min(1, Math.max(0, nextVolume));
      setVolume(clamped);
      if (videoRef.current) videoRef.current.volume = clamped;
    },
    [setVolume],
  );

  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onSkipBackward: skipBackward,
    onSkipForward: skipForward,
    onVolumeUp: () => changeVolume(volume + 0.1),
    onVolumeDown: () => changeVolume(volume - 0.1),
    onToggleMute: toggleMute,
    onToggleFullscreen: toggleFullscreen,
    onTogglePiP: togglePiP,
    onToggleSubtitles: () => {
      const firstSubtitle = availableSubtitles[0];
      selectSubtitle(activeSubtitleId ? null : firstSubtitle?.id || null);
    },
    onSeekPercent: (percent) => {
      if (duration > 0) seekToAbsoluteTime((percent / 100) * duration);
    },
    onCloseMenu: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
    },
  });

  const handleEpisodeChange = (newEpisodeId: string) => {
    saveProgress(true);
    navigate(`/watch/${media.id}/${newEpisodeId}`);
  };

  const handleRetry = () => {
    setErrorState(null);
    const video = videoRef.current;
    if (!video) return;
    video.load();
    video.play().catch(() => {});
  };

  const handleToggleTranscode = () => {
    const video = videoRef.current;
    const compatibilityMode: PlaybackMode =
      recommendedMode === 'direct' ? (isSafari ? 'hls' : 'audio') : recommendedMode;
    const nextMode: PlaybackMode =
      source.playbackMode === compatibilityMode ? 'direct' : compatibilityMode;

    suppressNextEpisode();
    resumeAfterSourceChangeRef.current =
      isPlaying || Boolean(video && !video.paused) ? nextMode : null;

    if (nextMode !== 'direct') {
      dispatchSource({
        type: 'setMode',
        playbackMode: nextMode,
        offsetSeconds: Math.floor(currentTime),
      });
      return;
    }

    // Going back to direct playback restores the absolute timeline, so the
    // current position has to be re-applied once the element reloads.
    recoveryPositionRef.current = currentTime;
    dispatchSource({ type: 'setMode', playbackMode: 'direct', offsetSeconds: 0 });
  };

  const cueStyle = useMemo(
    () => `
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
  `,
    [subtitleBgColor, subtitleFontSize],
  );

  const controlsVisible = areControlsVisible || !isPlaying;

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
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
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
          {active.title}
        </h2>
      </div>

      {/* Buffering Center Spinner */}
      {isBuffering && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-6 py-5 backdrop-blur-md">
            <Loader2 className="h-10 w-10 animate-spin text-brand-500" />
            <span className="text-xs font-semibold text-zinc-300">
              {connectionMessage || 'Akış tamponlanıyor…'}
            </span>
          </div>
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- caption tracks are rendered below from the resolved subtitle list */}
      <video
        ref={videoRef}
        src={source.playbackMode === 'hls' && !isSafari ? undefined : source.sourceUrl}
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
        onError={handleSourceError}
        onClick={togglePlay}
        className={`h-full w-full cursor-pointer object-contain transition-all duration-500 ${
          cinemaMode
            ? 'scale-[0.94] rounded-2xl border border-amber-500/20 shadow-[0_0_100px_rgba(245,158,11,0.2)]'
            : ''
        }`}
        playsInline
      >
        {resolvedSubtitles.map((subtitle) => (
          <track
            key={subtitle.id}
            src={getNativeSubtitleSource(subtitle)}
            kind="subtitles"
            srcLang={subtitle.language}
            label={subtitle.label || (subtitle.language || 'und').toUpperCase()}
            default={
              activeSubtitleId === subtitle.id || (subtitle.isDefault && !activeSubtitleId)
            }
            onLoad={markTrackLoaded}
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

      {delayToast && (
        <div className="absolute left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-brand-500/40 bg-zinc-950/90 px-4 py-2 text-xs font-bold text-white shadow-2xl backdrop-blur-md animate-fade-in">
          <Clock className="h-4 w-4 text-brand-400" />
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

      {showResumeModal && (
        <ResumeOverlay
          savedPositionSeconds={active.progress?.positionSeconds || 0}
          onResume={() => {
            if (active.progress?.positionSeconds) {
              seekToAbsoluteTime(
                active.progress.positionSeconds,
                true,
                source.playbackMode !== 'direct',
              );
            }
            setShowResumeModal(false);
          }}
          onRestart={() => {
            seekToAbsoluteTime(0);
            setShowResumeModal(false);
          }}
        />
      )}

      {showNextEpisodeModal && active.nextEpisode && (
        <NextEpisodeOverlay
          nextEpisodeTitle={active.nextEpisode.title}
          seasonNumber={active.nextEpisode.seasonNumber}
          episodeNumber={active.nextEpisode.episodeNumber}
          stillUrl={active.nextEpisode.stillUrl}
          posterUrl={media.posterUrl}
          overview={active.nextEpisode.overview}
          onPlayNext={() => {
            setShowNextEpisodeModal(false);
            handleEpisodeChange(active.nextEpisode!.id);
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
            dispatchSource({ type: 'setMode', playbackMode: isSafari ? 'hls' : 'audio' });
            handleRetry();
          }}
        />
      )}

      {/* Controls Overlay Bar */}
      <div
        className={`transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <PlayerControls
          mediaId={media.id}
          previewDriveFileId={active.driveFileId || undefined}
          seasonNumber={active.seasonNumber}
          episodeNumber={active.episodeNumber}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          bufferedTime={bufferedTime}
          volume={volume}
          isMuted={isMuted}
          playbackSpeed={playbackSpeed}
          subtitles={resolvedSubtitles}
          activeSubtitleId={activeSubtitleId}
          hasPreviousEpisode={!!active.previousEpisode}
          hasNextEpisode={!!active.nextEpisode}
          useTranscode={useTranscode}
          qualityPreference={source.qualityPreference}
          effectiveQuality={source.effectiveQuality}
          showQualityControl={source.playbackMode === 'full'}
          onSelectQuality={(quality) => {
            suppressNextEpisode();
            source.selectQuality(quality);
          }}
          onToggleTranscode={handleToggleTranscode}
          onTogglePlay={togglePlay}
          onSkipBackward={skipBackward}
          onSkipForward={skipForward}
          onSeek={seekToAbsoluteTime}
          onVolumeChange={changeVolume}
          onToggleMute={toggleMute}
          onSelectSpeed={(speed) => {
            setPlaybackSpeed(speed);
            if (videoRef.current) videoRef.current.playbackRate = speed;
          }}
          onSelectSubtitle={selectSubtitle}
          onUploadCustomSubtitle={subtitles.uploadCustomSubtitle}
          onSelectOpenSubtitle={handleSelectOpenSubtitle}
          onTogglePiP={togglePiP}
          onToggleFullscreen={toggleFullscreen}
          onPreviousEpisode={
            active.previousEpisode ? () => handleEpisodeChange(active.previousEpisode!.id) : undefined
          }
          onNextEpisode={
            active.nextEpisode ? () => handleEpisodeChange(active.nextEpisode!.id) : undefined
          }
        />
      </div>
    </div>
  );
};

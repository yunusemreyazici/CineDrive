import React, { useRef, useState, useCallback } from 'react';
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
import { convertSrtToVtt } from '@cinedrive/shared';
import type { PlayerErrorState, SubtitleTrackType } from '../types/player';
import type {
  MediaItemType,
  EpisodeType,
  PlaybackMode,
  PlaybackPlanType,
} from '../../../types/media';
import type { QualityPreference } from './QualityMenu';

interface MediaPlayerProps {
  media: MediaItemType;
  episodeId?: string;
}

const isSafariBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  return /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(navigator.userAgent);
};

const STALL_RECOVERY_DELAY_MS = 12_000;
const MAX_STALL_RECOVERY_ATTEMPTS = 2;
const QUALITY_STORAGE_KEY = 'cinedrive-player-quality-v1';

const getQualityStorage = () => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const initialQualityPreference = (): QualityPreference => {
  const stored = getQualityStorage()?.getItem(QUALITY_STORAGE_KEY);
  return stored === 'original' ||
    stored === '1080p' ||
    stored === '720p' ||
    stored === '480p'
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
      : connection?.effectiveType === '3g' ||
          (deviceMemory !== undefined && deviceMemory <= 4)
        ? '720p'
        : '1080p';

  if (sourceHeight && sourceHeight <= 480) quality = '480p';
  else if (sourceHeight && sourceHeight <= 720 && quality === '1080p') quality = '720p';
  return quality;
};

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ media, episodeId }) => {
  const navigate = useNavigate();
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
  const stallRecoveryAttemptsRef = useRef(0);
  const recoveryPositionRef = useRef<number | null>(null);
  const resumeAfterSourceChangeRef = useRef<PlaybackMode | null>(null);
  const suppressNextEpisodeUntilRef = useRef(0);

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
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [qualityPreference, setQualityPreference] = useState<QualityPreference>(
    initialQualityPreference,
  );

  const { areControlsVisible, resetHideTimer } = usePlayerControls(isPlaying);

  // Determine active drive file ID and episode details
  let targetDriveFileId: string | null = null;
  let titleDisplay = media.title;
  let episodes: EpisodeType[] = [];
  let currentEpisodeIndex = -1;
  let serverSubtitles: SubtitleTrackType[] = [];
  let currentSeasonNum: number | undefined = undefined;
  let currentEpisodeNum: number | undefined = undefined;
  let playbackPlan: PlaybackPlanType | undefined;
  let analyzedDuration: number | undefined;
  let analyzedHeight: number | undefined;

  if (media.type === 'movie' && media.movie) {
    targetDriveFileId = media.movie.driveFileId;
    playbackPlan = media.movie.playbackPlan;
    analyzedDuration = media.movie.technicalMetadata?.mediaDuration;
    analyzedHeight = media.movie.technicalMetadata?.mediaHeight;
    serverSubtitles = (media.subtitles || []) as unknown as SubtitleTrackType[];
  } else if (media.type === 'series' && media.series) {
    episodes = media.series.seasons.flatMap((s) => s.episodes);
    currentEpisodeIndex = episodeId
      ? episodes.findIndex((e) => e.id === episodeId)
      : 0;

    const activeEp = episodes[currentEpisodeIndex < 0 ? 0 : currentEpisodeIndex];
    if (activeEp) {
      targetDriveFileId = activeEp.driveFileId;
      playbackPlan = activeEp.playbackPlan;
      analyzedDuration = activeEp.technicalMetadata?.mediaDuration;
      analyzedHeight = activeEp.technicalMetadata?.mediaHeight;
      currentSeasonNum = activeEp.seasonNumber;
      currentEpisodeNum = activeEp.episodeNumber;
      titleDisplay = `${media.title} - ${activeEp.seasonNumber}x${activeEp.episodeNumber < 10 ? `0${activeEp.episodeNumber}` : activeEp.episodeNumber} ${activeEp.title}`;
      serverSubtitles = (activeEp.subtitles || media.subtitles || []) as unknown as SubtitleTrackType[];
    }
  }

  const recommendedPlaybackMode: PlaybackMode = isSafari
    ? playbackPlan?.safari || 'direct'
    : playbackPlan?.chromium || 'direct';
  const [playbackMode, setPlaybackMode] =
    useState<PlaybackMode>(recommendedPlaybackMode);
  const useTranscode = playbackMode !== 'direct';
  const automaticQuality = chooseAutoQuality(analyzedHeight);
  const [adaptiveQuality, setAdaptiveQuality] = useState(automaticQuality);
  const effectiveQuality =
    qualityPreference === 'auto'
      ? adaptiveQuality
      : qualityPreference;

  React.useEffect(() => {
    setPlaybackMode(recommendedPlaybackMode);
    setErrorState(null);
    stallRecoveryAttemptsRef.current = 0;
    recoveryPositionRef.current = null;
    setConnectionMessage(null);
    setAdaptiveQuality(automaticQuality);
  }, [automaticQuality, recommendedPlaybackMode, targetDriveFileId]);

  const availableSubtitles = [...serverSubtitles, ...customSubtitles];

  const createdUrlsRef = useRef<string[]>([]);

  // Revoke object URLs on unmount to prevent browser memory leaks
  React.useEffect(() => {
    const urlsToRevoke = createdUrlsRef.current;
    return () => {
      if (audioCompatibilityTimerRef.current) {
        clearTimeout(audioCompatibilityTimerRef.current);
      }
      if (stallRecoveryTimerRef.current) clearTimeout(stallRecoveryTimerRef.current);
      if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
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
      const sub = availableSubtitles[idx];
      if (sub && (sub.id === activeSubtitleId || (sub.isDefault && !activeSubtitleId))) {
        track.mode = 'showing';
      } else {
        track.mode = 'disabled';
      }
    });
  }, [activeSubtitleId, availableSubtitles]);

  // Live real-time subtitle cue timing offset shift
  const prevDelayRef = React.useRef(0);
  const [delayToast, setDelayToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!videoRef.current) return;
    const delta = subtitleDelay - prevDelayRef.current;
    if (delta === 0) return;

    const tracks = Array.from(videoRef.current.textTracks);
    tracks.forEach((track) => {
      if (track.cues) {
        Array.from(track.cues).forEach((cue) => {
          cue.startTime += delta;
          cue.endTime += delta;
        });
      }
    });

    prevDelayRef.current = subtitleDelay;
  }, [subtitleDelay]);

  // Z & X Keyboard Hotkeys for live subtitle delay adjustment
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
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
        message: 'Bu içerik için bağlı bir Google Drive video dosyası bulunamadı. Lütfen kütüphaneyi yeniden tarayın.',
        isRetryable: false,
      });
    }
  }, [targetDriveFileId]);

  const handleCustomSubtitleUpload = async (file: File) => {
    try {
      const text = await file.text();
      const isSrt = file.name.toLowerCase().endsWith('.srt');
      const vttText = isSrt ? convertSrtToVtt(text) : text;

      const blob = new Blob([vttText], { type: 'text/vtt' });
      const objectUrl = URL.createObjectURL(blob);
      createdUrlsRef.current.push(objectUrl);

      const customTrack: SubtitleTrackType = {
        id: `custom_${Date.now()}`,
        language: 'tr',
        label: `${file.name.replace(/\.[^/.]+$/, '')} (Yerel)`,
        isForced: false,
        isHearingImpaired: false,
        isDefault: true,
        url: objectUrl,
      };

      setCustomSubtitles((prev) => [...prev, customTrack]);
      setActiveSubtitleId(customTrack.id);
    } catch {
      // Subtitle parse error handled silently
    }
  };

  const handleSelectOpenSubtitle = async (
    fileId: number,
    label: string,
    languageCode: string,
  ) => {
    const res = await fetch('/api/media/subtitles/opensubtitles/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    });

    if (!res.ok) throw new Error('Download failed');
    const vttText = await res.text();
    const blob = new Blob([vttText], { type: 'text/vtt' });
    const objectUrl = URL.createObjectURL(blob);
    createdUrlsRef.current.push(objectUrl);

    const openSubTrack: SubtitleTrackType = {
      id: `opensub_${Date.now()}`,
      language: languageCode,
      label,
      isForced: false,
      isHearingImpaired: false,
      isDefault: true,
      url: objectUrl,
    };

    setCustomSubtitles((prev) => [...prev, openSubTrack]);
    setActiveSubtitleId(openSubTrack.id);
  };

  const cueStyle = `
    ::cue {
      font-size: ${subtitleFontSize}%;
      background-color: ${
        subtitleBgColor === 'black'
          ? 'rgba(0, 0, 0, 0.85)'
          : 'transparent'
      };
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
      ? `/api/media/${targetDriveFileId}/hls/index.m3u8`
      : `/api/media/${targetDriveFileId}/stream${
          playbackMode === 'audio'
            ? '?transcode=audio'
            : playbackMode === 'full'
              ? `?transcode=full&quality=${effectiveQuality}`
              : ''
        }`
    : '';

  React.useLayoutEffect(() => {
    suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
  }, [videoSourceUrl]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || resumeAfterSourceChangeRef.current !== playbackMode) return;

    let cancelled = false;
    const resume = () => {
      if (
        cancelled ||
        resumeAfterSourceChangeRef.current !== playbackMode
      ) {
        return;
      }

      video
        .play()
        .catch(() => {
          // Keep listening for the next readiness event.
        });
    };

    video.addEventListener('canplay', resume);
    const resumeTimers = [0, 250, 1_000, 2_500].map((delay) =>
      setTimeout(resume, delay),
    );
    return () => {
      cancelled = true;
      resumeTimers.forEach(clearTimeout);
      video.removeEventListener('canplay', resume);
    };
  }, [playbackMode, videoSourceUrl]);

  // Playback Progress Sync Hook
  const { saveProgress } = usePlaybackProgress({
    mediaItemId: media.id,
    episodeId,
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
      video.currentTime = recoveryPosition;
      video.play().catch(() => {});
      return;
    }

    // Check if saved resume position exists (> 15s and not completed)
    const savedPos = media.progress?.positionSeconds || 0;
    const isCompleted = media.progress?.completed;

    if (
      !isCompleted &&
      savedPos > 15 &&
      savedPos < (analyzedDuration || video.duration) - 30
    ) {
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
        suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
        resumeAfterSourceChangeRef.current = 'audio';
        setPlaybackMode('audio');
      }
    }, 6000);
  }, [clearAudioCompatibilityCheck, isMuted, useTranscode, volume]);

  const handleResumeClick = () => {
    if (videoRef.current && media.progress?.positionSeconds) {
      videoRef.current.currentTime = media.progress.positionSeconds;
      videoRef.current.play().catch(() => {});
    }
    setShowResumeModal(false);
  };

  const handleRestartClick = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    setShowResumeModal(false);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);

    // Calculate buffered range
    if (videoRef.current.buffered.length > 0) {
      setBufferedTime(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
    }

    const reportedDuration = analyzedDuration || videoRef.current.duration;
    if (!Number.isFinite(reportedDuration) || reportedDuration <= 0) return;
    if (Date.now() < suppressNextEpisodeUntilRef.current) return;

    // Trigger next episode overlay when 15s remaining or 94% completion
    const playbackPosition = videoRef.current.currentTime;
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
      (remainingSeconds >= 0 && remainingSeconds <= 15) ||
      (percentage >= 94 && percentage <= 100);
    if (
      isNearEnd &&
      !showNextEpisodeModal &&
      !nextEpisodeDismissedRef.current &&
      nextEpisode
    ) {
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
        setBufferedTime(end);
        return;
      }
    }
  }, []);

  const clearStallRecoveryTimer = useCallback(() => {
    if (!stallRecoveryTimerRef.current) return;
    clearTimeout(stallRecoveryTimerRef.current);
    stallRecoveryTimerRef.current = null;
  }, []);

  const handleWaiting = useCallback(() => {
    setIsBuffering(true);
    clearStallRecoveryTimer();

    if (playbackMode === 'full' && qualityPreference === 'auto') {
      stallRecoveryTimerRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (!video || video.paused || video.currentTime >= 10) return;

        const nextQuality =
          effectiveQuality === 'original' || effectiveQuality === '1080p'
            ? '720p'
            : effectiveQuality === '720p'
              ? '480p'
              : null;
        if (!nextQuality) return;

        suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
        setConnectionMessage(`Başlangıç akışı ${nextQuality} kalitesinde yeniden hazırlanıyor`);
        setAdaptiveQuality(nextQuality);
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
      recoveryPositionRef.current = video.currentTime;
      setConnectionMessage(
        `Bağlantı yeniden kuruluyor (${stallRecoveryAttemptsRef.current}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
      );
      video.load();
    }, STALL_RECOVERY_DELAY_MS);
  }, [clearStallRecoveryTimer, effectiveQuality, playbackMode, qualityPreference]);

  const handlePlaying = useCallback(() => {
    if (resumeAfterSourceChangeRef.current === playbackMode) {
      resumeAfterSourceChangeRef.current = null;
    }
    setIsBuffering(false);
    setConnectionMessage(null);
    clearStallRecoveryTimer();

    if (stablePlaybackTimerRef.current) clearTimeout(stablePlaybackTimerRef.current);
    stablePlaybackTimerRef.current = setTimeout(() => {
      stallRecoveryAttemptsRef.current = 0;
    }, 30_000);
  }, [clearStallRecoveryTimer, playbackMode]);

  const handleCanPlayReady = useCallback(() => {
    setIsBuffering(false);
    clearStallRecoveryTimer();
  }, [clearStallRecoveryTimer]);

  const handleVideoEnded = () => {
    const video = videoRef.current;
    const reportedDuration = analyzedDuration || duration || video?.duration || 0;
    const playbackPosition = video?.currentTime || 0;
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
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
  }, []);

  const skipForward = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
  }, [duration]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted, setIsMuted]);

  const toggleFullscreen = useCallback(() => {
    if (!videoRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.requestFullscreen();
    }
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
      setActiveSubtitleId(activeSubtitleId ? null : firstSub ? firstSub.id : null);
    },
    onSeekPercent: (percent) => {
      if (videoRef.current && duration > 0) {
        videoRef.current.currentTime = (percent / 100) * duration;
      }
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
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
      className="fixed inset-0 z-50 bg-black flex flex-col justify-between select-none overflow-hidden"
    >
      <style>{cueStyle}</style>

      {/* Top Navigation Header Bar */}
      <div
        className={`absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-30 flex items-center gap-4 transition-opacity duration-300 ${
          areControlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          onClick={() => {
            saveProgress(true);
            navigate(`/media/${media.id}`);
          }}
          className="p-3 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-full backdrop-blur-md transition-colors"
          aria-label="Geri Dön"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold font-display text-white truncate">{titleDisplay}</h2>
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
        src={videoSourceUrl}
        onPlay={() => {
          setIsPlaying(true);
          checkForUnsupportedAudio();
        }}
        onPause={() => {
          setIsPlaying(false);
          clearAudioCompatibilityCheck();
        }}
        onWaiting={handleWaiting}
        onStalled={handleWaiting}
        onPlaying={handlePlaying}
        onCanPlay={handleCanPlayReady}
        onProgress={updateBufferedTime}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleVideoEnded}
        onError={() => {
          // Safari reports unsupported containers/codecs as a generic media
          // error. Retry once with full H.264/AAC compatibility transcoding;
          // if that also fails, show the actionable player error.
          if (playbackMode === 'direct' || playbackMode === 'audio') {
            const fallbackMode: PlaybackMode = isSafari ? 'hls' : 'full';
            suppressNextEpisodeUntilRef.current = Date.now() + 20_000;
            resumeAfterSourceChangeRef.current = isPlaying ? fallbackMode : null;
            setErrorState(null);
            setPlaybackMode(fallbackMode);
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
          cinemaMode ? 'scale-[0.94] rounded-2xl shadow-[0_0_100px_rgba(245,158,11,0.2)] border border-amber-500/20' : ''
        }`}
        playsInline
      >
        {availableSubtitles.map((sub) => (
          <track
            key={sub.id}
            src={(sub as unknown as { url?: string }).url || `/api/media/${sub.id}/subtitle`}
            kind="subtitles"
            srcLang={sub.language}
            label={sub.label || sub.language.toUpperCase()}
            default={sub.isDefault || activeSubtitleId === sub.id}
          />
        ))}
      </video>

      {/* Subtitle Delay Live Toast Notification Overlay */}
      {delayToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-zinc-950/90 backdrop-blur-md border border-brand-500/40 rounded-2xl text-xs font-bold text-white shadow-2xl animate-fade-in flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-400" />
          <span>{delayToast}</span>
        </div>
      )}

      {/* Overlays */}
      {showResumeModal && (
        <ResumeOverlay
          savedPositionSeconds={media.progress?.positionSeconds || 0}
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
          seasonNumber={currentSeasonNum}
          episodeNumber={currentEpisodeNum}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          bufferedTime={bufferedTime}
          volume={volume}
          isMuted={isMuted}
          playbackSpeed={playbackSpeed}
          subtitles={availableSubtitles}
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
            setPlaybackMode(nextMode);
          }}
          onTogglePlay={togglePlay}
          onSkipBackward={skipBackward}
          onSkipForward={skipForward}
          onSeek={(time) => {
            if (videoRef.current) videoRef.current.currentTime = time;
          }}
          onVolumeChange={(vol) => {
            setVolume(vol);
            if (videoRef.current) videoRef.current.volume = vol;
          }}
          onToggleMute={toggleMute}
          onSelectSpeed={(speed) => {
            setPlaybackSpeed(speed);
            if (videoRef.current) videoRef.current.playbackRate = speed;
          }}
          onSelectSubtitle={setActiveSubtitleId}
          onUploadCustomSubtitle={handleCustomSubtitleUpload}
          onSelectOpenSubtitle={handleSelectOpenSubtitle}
          onTogglePiP={togglePiP}
          onToggleFullscreen={toggleFullscreen}
          onPreviousEpisode={previousEpisode ? () => handleEpisodeChange(previousEpisode.id) : undefined}
          onNextEpisode={nextEpisode ? () => handleEpisodeChange(nextEpisode.id) : undefined}
        />
      </div>
    </div>
  );
};

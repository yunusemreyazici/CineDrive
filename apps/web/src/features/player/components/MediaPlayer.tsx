import React, { useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
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
import type { MediaItemType, EpisodeType } from '../../../types/media';

interface MediaPlayerProps {
  media: MediaItemType;
  episodeId?: string;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ media, episodeId }) => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Player Store State
  const {
    volume,
    isMuted,
    playbackSpeed,
    activeSubtitleId,
    autoPlayNext,
    setVolume,
    setIsMuted,
    setPlaybackSpeed,
    setActiveSubtitleId,
  } = usePlayerStore();
  const { cinemaMode } = useUiStore();

  // Local Media & Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showNextEpisodeModal, setShowNextEpisodeModal] = useState(false);
  const [errorState, setErrorState] = useState<PlayerErrorState | null>(null);
  const [customSubtitles, setCustomSubtitles] = useState<SubtitleTrackType[]>([]);

  const { areControlsVisible, resetHideTimer } = usePlayerControls(isPlaying);

  // Determine active drive file ID and episode details
  let targetDriveFileId: string | null = null;
  let titleDisplay = media.title;
  let episodes: EpisodeType[] = [];
  let currentEpisodeIndex = -1;
  let serverSubtitles: SubtitleTrackType[] = [];
  let currentSeasonNum: number | undefined = undefined;
  let currentEpisodeNum: number | undefined = undefined;

  if (media.type === 'movie' && media.movie) {
    targetDriveFileId = media.movie.driveFileId;
    serverSubtitles = (media.subtitles || []) as unknown as SubtitleTrackType[];
  } else if (media.type === 'series' && media.series) {
    episodes = media.series.seasons.flatMap((s) => s.episodes);
    currentEpisodeIndex = episodeId
      ? episodes.findIndex((e) => e.id === episodeId)
      : 0;

    const activeEp = episodes[currentEpisodeIndex < 0 ? 0 : currentEpisodeIndex];
    if (activeEp) {
      targetDriveFileId = activeEp.driveFileId;
      currentSeasonNum = activeEp.seasonNumber;
      currentEpisodeNum = activeEp.episodeNumber;
      titleDisplay = `${media.title} - ${activeEp.seasonNumber}x${activeEp.episodeNumber < 10 ? `0${activeEp.episodeNumber}` : activeEp.episodeNumber} ${activeEp.title}`;
      serverSubtitles = (activeEp.subtitles || media.subtitles || []) as unknown as SubtitleTrackType[];
    }
  }

  const availableSubtitles = [...serverSubtitles, ...customSubtitles];

  const createdUrlsRef = useRef<string[]>([]);

  // Revoke object URLs on unmount to prevent browser memory leaks
  React.useEffect(() => {
    const urlsToRevoke = createdUrlsRef.current;
    return () => {
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

  const handleSelectOpenSubtitle = async (downloadUrl: string, label: string) => {
    const res = await fetch('/api/media/subtitles/opensubtitles/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadUrl }),
    });

    if (!res.ok) throw new Error('Download failed');
    const vttText = await res.text();
    const blob = new Blob([vttText], { type: 'text/vtt' });
    const objectUrl = URL.createObjectURL(blob);
    createdUrlsRef.current.push(objectUrl);

    const openSubTrack: SubtitleTrackType = {
      id: `opensub_${Date.now()}`,
      language: 'tr',
      label,
      isForced: false,
      isHearingImpaired: false,
      isDefault: true,
      url: objectUrl,
    };

    setCustomSubtitles((prev) => [...prev, openSubTrack]);
    setActiveSubtitleId(openSubTrack.id);
  };

  const { subtitleFontSize, subtitleBgColor } = usePlayerStore();
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

  // Stream URL directly to backend endpoint (ZERO FETCH / ZERO BLOB!)
  const streamUrl = targetDriveFileId ? `/api/media/${targetDriveFileId}/stream` : '';

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
    setDuration(videoRef.current.duration);

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

    // Check if saved resume position exists (> 15s and not completed)
    const savedPos = media.progress?.positionSeconds || 0;
    const isCompleted = media.progress?.completed;

    if (!isCompleted && savedPos > 15 && savedPos < video.duration - 30) {
      video.pause();
      setShowResumeModal(true);
    } else {
      video.play().catch(() => {});
    }
  };

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

    // Trigger next episode overlay when 15s remaining or 94% completion
    const remainingSeconds = videoRef.current.duration - videoRef.current.currentTime;
    const percentage = (videoRef.current.currentTime / videoRef.current.duration) * 100;
    if ((remainingSeconds <= 15 || percentage >= 94) && !showNextEpisodeModal && nextEpisode) {
      saveProgress(true);
      if (autoPlayNext) {
        setShowNextEpisodeModal(true);
      }
    }
  };

  const handleVideoEnded = () => {
    saveProgress(true);
    if (nextEpisode && autoPlayNext) {
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
          <div className="p-4 bg-zinc-950/70 border border-zinc-800 rounded-full backdrop-blur-md">
            <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
          </div>
        </div>
      )}

      {/* HTML5 Native Video Stream Element with Subtitle Tracks */}
      <video
        ref={videoRef}
        src={streamUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleVideoEnded}
        onError={() =>
          setErrorState({
            code: 'STREAM_FAILED',
            message: 'Video akışı sunucudan alınırken hata oluştu.',
            isRetryable: true,
          })
        }
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
          onCancel={() => setShowNextEpisodeModal(false)}
        />
      )}

      {errorState && <PlayerError error={errorState} onRetry={handleRetry} />}

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

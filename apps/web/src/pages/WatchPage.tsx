import React, { useRef, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize } from 'lucide-react';
import { useMediaDetailQuery, useUpdateProgressMutation } from '../hooks/useApi';
import type { EpisodeType } from '../types/media';

export const WatchPage: React.FC = () => {
  const { mediaId, episodeId } = useParams<{ mediaId: string; episodeId?: string }>();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const { data: media, isLoading } = useMediaDetailQuery(mediaId);
  const updateProgress = useUpdateProgressMutation();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Find targeted drive file ID for movie or episode
  let targetDriveFileId: string | null = null;
  let titleDisplay = media?.title || '';

  if (media) {
    if (media.type === 'movie' && media.movie) {
      targetDriveFileId = media.movie.driveFileId;
    } else if (media.type === 'series' && media.series) {
      const episodes: EpisodeType[] = media.series.seasons.flatMap((s) => s.episodes);
      const activeEp = episodeId
        ? episodes.find((e) => e.id === episodeId)
        : episodes[0];

      if (activeEp) {
        targetDriveFileId = activeEp.driveFileId;
        titleDisplay = `${media.title} - ${activeEp.seasonNumber}x${activeEp.episodeNumber < 10 ? `0${activeEp.episodeNumber}` : activeEp.episodeNumber} ${activeEp.title}`;
      }
    }
  }

  // Periodic progress saving (every 10 seconds)
  useEffect(() => {
    if (!mediaId || !isPlaying) return;

    const interval = setInterval(() => {
      if (videoRef.current && duration > 0) {
        const pos = Math.floor(videoRef.current.currentTime);
        updateProgress.mutate({
          mediaItemId: mediaId,
          episodeId: episodeId || undefined,
          positionSeconds: pos,
          durationSeconds: Math.floor(duration),
        });
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [mediaId, episodeId, isPlaying, duration]);

  // Save final progress on component unmount
  useEffect(() => {
    return () => {
      if (videoRef.current && duration > 0 && mediaId) {
        const pos = Math.floor(videoRef.current.currentTime);
        if (pos > 0) {
          updateProgress.mutate({
            mediaItemId: mediaId,
            episodeId: episodeId || undefined,
            positionSeconds: pos,
            durationSeconds: Math.floor(duration),
          });
        }
      }
    };
  }, [mediaId, episodeId, duration]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      // Resume from saved position if available
      const savedPos = media?.progress?.positionSeconds || 0;
      if (savedPos > 5 && savedPos < videoRef.current.duration - 30) {
        videoRef.current.currentTime = savedPos;
      }
    }
  };

  const skipTime = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  if (isLoading || !targetDriveFileId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white font-display">
        Yayın Yükleniyor...
      </div>
    );
  }

  const streamUrl = `/api/media/${targetDriveFileId}/stream`;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between select-none">
      {/* Top Header Overlay */}
      <div className="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/80 to-transparent z-20 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-3 bg-zinc-900/80 hover:bg-zinc-800 text-white rounded-full backdrop-blur-md transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold font-display text-white truncate">{titleDisplay}</h2>
      </div>

      {/* Video Element */}
      <video
        ref={videoRef}
        src={streamUrl}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onClick={togglePlay}
        className="w-full h-full object-contain cursor-pointer"
        autoPlay
        playsInline
      />

      {/* Bottom Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent z-20 space-y-3">
        {/* Progress Bar */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = val;
          }}
          className="w-full h-1.5 bg-zinc-800 accent-brand-500 rounded-lg cursor-pointer"
        />

        {/* Buttons Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="text-white hover:text-brand-400">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current" />}
            </button>
            <button onClick={() => skipTime(-10)} className="text-zinc-400 hover:text-white">
              <RotateCcw className="w-5 h-5" />
            </button>
            <button onClick={() => skipTime(10)} className="text-zinc-400 hover:text-white">
              <RotateCw className="w-5 h-5" />
            </button>
            <button onClick={toggleMute} className="text-zinc-400 hover:text-white">
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <span className="text-xs text-zinc-400 font-medium">
              {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} /{' '}
              {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
            </span>
          </div>

          <button onClick={toggleFullscreen} className="text-zinc-400 hover:text-white">
            <Maximize className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

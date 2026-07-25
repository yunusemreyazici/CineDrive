import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  PictureInPicture2,
  Subtitles,
  Gauge,
  SkipBack,
  SkipForward,
  Sparkles,
  Radio,
  MonitorUp,
} from 'lucide-react';
import { PlayerTimeline } from './PlayerTimeline';
import { SubtitleMenu } from './SubtitleMenu';
import { PlaybackSpeedMenu } from './PlaybackSpeedMenu';
import { useUiStore } from '../../../stores/useUiStore';
import type { SubtitleTrackType } from '../types/player';
import { QualityMenu, type QualityPreference } from './QualityMenu';

interface PlayerControlsProps {
  mediaId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  volume: number;
  isMuted: boolean;
  playbackSpeed: number;
  subtitles?: SubtitleTrackType[];
  activeSubtitleId: string | null;
  hasPreviousEpisode?: boolean;
  hasNextEpisode?: boolean;
  useTranscode?: boolean;
  qualityPreference?: QualityPreference;
  effectiveQuality?: Exclude<QualityPreference, 'auto'>;
  showQualityControl?: boolean;
  onSelectQuality?: (quality: QualityPreference) => void;
  onToggleTranscode?: () => void;
  onTogglePlay: () => void;
  onSkipBackward: () => void;
  onSkipForward: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onSelectSpeed: (speed: number) => void;
  onSelectSubtitle: (id: string | null) => void;
  onUploadCustomSubtitle?: (file: File) => void;
  onSelectOpenSubtitle?: (fileId: number, label: string, languageCode: string) => Promise<void>;
  onTogglePiP: () => void;
  onToggleFullscreen: () => void;
  onPreviousEpisode?: () => void;
  onNextEpisode?: () => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  mediaId,
  seasonNumber,
  episodeNumber,
  isPlaying,
  currentTime,
  duration,
  bufferedTime,
  volume,
  isMuted,
  playbackSpeed,
  subtitles = [],
  activeSubtitleId,
  hasPreviousEpisode,
  hasNextEpisode,
  useTranscode = false,
  qualityPreference = 'auto',
  effectiveQuality = '1080p',
  showQualityControl = false,
  onSelectQuality,
  onToggleTranscode,
  onTogglePlay,
  onSkipBackward,
  onSkipForward,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onSelectSpeed,
  onSelectSubtitle,
  onUploadCustomSubtitle,
  onSelectOpenSubtitle,
  onTogglePiP,
  onToggleFullscreen,
  onPreviousEpisode,
  onNextEpisode,
}) => {
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const { cinemaMode, toggleCinemaMode } = useUiStore();
  const bufferAhead = Math.max(0, bufferedTime - currentTime);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/95 via-black/50 to-transparent z-30 space-y-3">
      {/* Subtitle & Speed Menus */}
      {subtitleMenuOpen && (
        <SubtitleMenu
          mediaId={mediaId}
          seasonNumber={seasonNumber}
          episodeNumber={episodeNumber}
          subtitles={subtitles}
          activeSubtitleId={activeSubtitleId}
          onSelectSubtitle={onSelectSubtitle}
          onUploadCustomSubtitle={onUploadCustomSubtitle}
          onSelectOpenSubtitle={onSelectOpenSubtitle}
          onClose={() => setSubtitleMenuOpen(false)}
        />
      )}

      {speedMenuOpen && (
        <PlaybackSpeedMenu
          currentSpeed={playbackSpeed}
          onSelectSpeed={onSelectSpeed}
          onClose={() => setSpeedMenuOpen(false)}
        />
      )}

      {qualityMenuOpen && onSelectQuality ? (
        <QualityMenu
          currentQuality={qualityPreference}
          effectiveQuality={effectiveQuality}
          onSelectQuality={onSelectQuality}
          onClose={() => setQualityMenuOpen(false)}
        />
      ) : null}

      {/* Scrubbing Timeline */}
      <PlayerTimeline
        currentTime={currentTime}
        duration={duration}
        bufferedTime={bufferedTime}
        onSeek={onSeek}
      />

      {/* Control Buttons Bar */}
      <div className="flex items-center justify-between">
        {/* Left Action Controls */}
        <div className="flex items-center gap-3">
          {hasPreviousEpisode && onPreviousEpisode && (
            <button
              onClick={onPreviousEpisode}
              aria-label="Önceki Bölüm"
              className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
          )}

          <button
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Duraklat' : 'Oynat'}
            className="p-3 bg-brand-600 hover:bg-brand-500 text-white rounded-full shadow-lg shadow-brand-500/30 transition-transform active:scale-95"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
          </button>

          {hasNextEpisode && onNextEpisode && (
            <button
              onClick={onNextEpisode}
              aria-label="Sonraki Bölüm"
              className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
          )}

          <button
            onClick={onSkipBackward}
            aria-label="10 Saniye Geri"
            className="p-2 text-zinc-400 hover:text-white transition-colors"
          >
            <RotateCcw className="w-5 h-5" />
          </button>

          <button
            onClick={onSkipForward}
            aria-label="10 Saniye İleri"
            className="p-2 text-zinc-400 hover:text-white transition-colors"
          >
            <RotateCw className="w-5 h-5" />
          </button>

          {/* Volume Control Group */}
          <div className="flex items-center gap-2 group">
            <button
              onClick={onToggleMute}
              aria-label={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              aria-label="Ses Seviyesi"
              className="w-16 h-1 bg-zinc-800 accent-brand-500 rounded-lg cursor-pointer opacity-75 group-hover:opacity-100 transition-opacity"
            />
          </div>

          {/* Time Display */}
          <div className="text-xs text-zinc-400 font-medium ml-2 font-display">
            <span>{formatTime(currentTime)}</span>
            <span className="mx-1 text-zinc-600">/</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div
            className="hidden md:flex items-center gap-1.5 text-[11px] text-zinc-500"
            title="İndirilen ileri oynatma tamponu"
          >
            <Radio className="h-3.5 w-3.5" />
            {Math.floor(bufferAhead)} sn hazır
          </div>
        </div>

        {/* Right Settings Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSubtitleMenuOpen(!subtitleMenuOpen);
              setSpeedMenuOpen(false);
            }}
            aria-label="Altyazı Menüsü"
            className={`p-2 rounded-xl transition-colors ${
              activeSubtitleId ? 'text-brand-400 bg-brand-600/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Subtitles className="w-5 h-5" />
          </button>

          {onToggleTranscode && (
            <button
              onClick={onToggleTranscode}
              aria-label="Ses / Safari Uyum Modu"
              title={useTranscode ? 'Ses Uyum Modu (AAC Transcode) Aktif' : 'Ses / Safari Uyum Modunu Etkinleştir (AAC)'}
              className={`p-2 rounded-xl transition-colors ${
                useTranscode ? 'text-amber-400 bg-amber-500/20' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Radio className="w-5 h-5" />
            </button>
          )}

          {showQualityControl && onSelectQuality ? (
            <button
              onClick={() => {
                setQualityMenuOpen(!qualityMenuOpen);
                setSpeedMenuOpen(false);
                setSubtitleMenuOpen(false);
              }}
              aria-label="Görüntü Kalitesi"
              title={`Görüntü kalitesi: ${qualityPreference === 'auto' ? `Otomatik (${effectiveQuality})` : qualityPreference}`}
              className="rounded-xl p-2 text-zinc-400 transition-colors hover:text-white"
            >
              <MonitorUp className="h-5 w-5" />
            </button>
          ) : null}

          <button
            onClick={() => {
              setSpeedMenuOpen(!speedMenuOpen);
              setSubtitleMenuOpen(false);
            }}
            aria-label="Oynatma Hızı"
            className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors"
          >
            <Gauge className="w-5 h-5" />
          </button>

          <button
            onClick={onTogglePiP}
            aria-label="Picture in Picture"
            className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors hidden sm:block"
          >
            <PictureInPicture2 className="w-5 h-5" />
          </button>

          <button
            onClick={toggleCinemaMode}
            aria-label="Sinema Modu"
            title="Sinema Işıkları"
            className={`p-2 rounded-xl transition-colors hidden sm:block ${
              cinemaMode ? 'text-amber-400 bg-amber-500/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-5 h-5" />
          </button>

          <button
            onClick={onToggleFullscreen}
            aria-label="Tam Ekran"
            className="p-2 rounded-xl text-zinc-400 hover:text-white transition-colors"
          >
            <Maximize className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

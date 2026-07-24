export type PlaybackMode = 'direct' | 'audio' | 'hls' | 'full';

export interface PlaybackPlan {
  safari: PlaybackMode;
  chromium: PlaybackMode;
  reason: string;
  analyzed: boolean;
}

interface PlaybackSource {
  mediaContainer?: string | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  mediaAnalyzedAt?: Date | null;
}

const SAFARI_DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'mov']);
const CHROMIUM_DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'webm']);
const SAFARI_VIDEO_CODECS = new Set(['h264', 'hevc']);
const CHROMIUM_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const SAFARI_AUDIO_CODECS = new Set(['aac', 'ac3', 'eac3', 'mp3']);
const CHROMIUM_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis']);

export const buildPlaybackPlan = (source: PlaybackSource): PlaybackPlan => {
  if (!source.mediaAnalyzedAt || !source.videoCodec) {
    return {
      safari: 'direct',
      chromium: 'direct',
      reason: 'technical_metadata_missing',
      analyzed: false,
    };
  }

  const container = source.mediaContainer?.toLowerCase() || '';
  const video = source.videoCodec.toLowerCase();
  const audio = source.audioCodec?.toLowerCase() || '';

  const safariVideoCompatible = SAFARI_VIDEO_CODECS.has(video);
  const safariDirect =
    SAFARI_DIRECT_CONTAINERS.has(container) &&
    safariVideoCompatible &&
    SAFARI_AUDIO_CODECS.has(audio);
  const safari: PlaybackMode = safariDirect ? 'direct' : 'hls';

  const chromiumVideoCompatible = CHROMIUM_VIDEO_CODECS.has(video);
  const chromiumDirect =
    CHROMIUM_DIRECT_CONTAINERS.has(container) &&
    chromiumVideoCompatible &&
    CHROMIUM_AUDIO_CODECS.has(audio);
  const chromium: PlaybackMode = chromiumDirect
    ? 'direct'
    : chromiumVideoCompatible
      ? 'audio'
      : 'full';

  return {
    safari,
    chromium,
    reason: `${container || 'unknown'}:${video}:${audio || 'none'}`,
    analyzed: true,
  };
};

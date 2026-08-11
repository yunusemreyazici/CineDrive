import type { MusicTrackDto } from '@cinedrive/shared';

export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14_000] as const;
export type EqPreset = 'flat' | 'bass' | 'vocal' | 'treble' | 'night' | 'custom';

export interface MusicAudioSettings {
  normalizationEnabled: boolean;
  crossfadeSeconds: number;
  gaplessEnabled: boolean;
  equalizerEnabled: boolean;
  eqPreset: EqPreset;
  eqGains: number[];
}

export const DEFAULT_MUSIC_AUDIO_SETTINGS: MusicAudioSettings = {
  normalizationEnabled: true,
  crossfadeSeconds: 0,
  gaplessEnabled: true,
  equalizerEnabled: false,
  eqPreset: 'flat',
  eqGains: [0, 0, 0, 0, 0],
};

export const EQ_PRESETS: Record<Exclude<EqPreset, 'custom'>, number[]> = {
  flat: [0, 0, 0, 0, 0],
  bass: [5, 3, 0, -1, -2],
  vocal: [-2, 0, 3, 4, 1],
  treble: [-2, -1, 0, 3, 5],
  night: [2, 1, 0, -2, -4],
};

const codecLabel = (codec?: string | null, container?: string | null) => {
  const value = (codec || container || '').toLowerCase();
  if (value.includes('flac')) return 'FLAC';
  if (value.includes('alac')) return 'ALAC';
  if (value.includes('aac')) return 'AAC';
  if (value.includes('mp3') || value.includes('mpeg')) return 'MP3';
  if (value.includes('opus')) return 'Opus';
  if (value.includes('vorbis') || value.includes('ogg')) return 'OGG';
  if (value.includes('pcm') || value.includes('wav')) return 'WAV';
  if (value.includes('wma')) return 'WMA';
  return value ? value.toUpperCase() : null;
};

const formatSampleRate = (sampleRate?: number | null) => {
  if (!sampleRate) return null;
  const kHz = sampleRate / 1000;
  return `${Number.isInteger(kHz) ? kHz : kHz.toFixed(1)} kHz`;
};

export const formatAudioQuality = (track?: MusicTrackDto | null) => {
  if (!track?.audio) return null;
  const { codec, container, bitDepth, sampleRate, bitrate } = track.audio;
  const parts = [
    codecLabel(codec, container),
    bitDepth ? `${bitDepth}-bit` : null,
    formatSampleRate(sampleRate),
  ].filter(Boolean);
  if (parts.length <= 1 && bitrate) parts.push(`${Math.round(bitrate / 1000)} kbps`);
  return parts.length ? parts.join(' · ') : null;
};

export const audioQualityTier = (track?: MusicTrackDto | null) => {
  const audio = track?.audio;
  if (!audio) return null;
  if (audio.lossless && ((audio.bitDepth || 0) > 16 || (audio.sampleRate || 0) > 48_000))
    return 'hi_res' as const;
  if (audio.lossless) return 'lossless' as const;
  return null;
};

export const replayGainLinear = (track: MusicTrackDto | null, enabled: boolean) => {
  if (!enabled || !track?.audio) return 1;
  const gainDb = track.audio.replayGainTrackDb ?? track.audio.replayGainAlbumDb;
  if (gainDb === null || gainDb === undefined || !Number.isFinite(gainDb)) return 1;
  let gain = Math.pow(10, gainDb / 20);
  const peak = track.audio.replayGainTrackPeak ?? track.audio.replayGainAlbumPeak;
  if (peak && peak > 0 && peak * gain > 1) gain = 1 / peak;
  return Math.min(2, Math.max(0.25, gain));
};

export const logicalMusicPosition = (
  currentTime: number,
  transcode: boolean,
  transcodeStart: number,
) => currentTime + (transcode ? transcodeStart : 0);

export const requiresMusicTranscode = (track?: MusicTrackDto | null) => {
  if (!track) return false;
  const fileExtension = track.source?.fileName.split('.').pop()?.toLowerCase() || '';
  const value = [track.audio?.codec, track.audio?.container, track.source?.mimeType, fileExtension]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return ['ogg', 'vorbis', 'opus', 'wma', 'wmav', 'asf'].some((marker) => value.includes(marker));
};

export const parseStoredAudioSettings = (raw: string | null): MusicAudioSettings => {
  if (!raw) return DEFAULT_MUSIC_AUDIO_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<MusicAudioSettings>;
    const gains = Array.isArray(parsed.eqGains)
      ? parsed.eqGains.slice(0, 5).map((value) => Math.min(12, Math.max(-12, Number(value) || 0)))
      : DEFAULT_MUSIC_AUDIO_SETTINGS.eqGains;
    return {
      normalizationEnabled: parsed.normalizationEnabled !== false,
      crossfadeSeconds: Math.min(10, Math.max(0, Number(parsed.crossfadeSeconds) || 0)),
      gaplessEnabled: parsed.gaplessEnabled !== false,
      equalizerEnabled: parsed.equalizerEnabled === true,
      eqPreset: parsed.eqPreset || 'flat',
      eqGains: gains.length === 5 ? gains : DEFAULT_MUSIC_AUDIO_SETTINGS.eqGains,
    };
  } catch {
    return DEFAULT_MUSIC_AUDIO_SETTINGS;
  }
};

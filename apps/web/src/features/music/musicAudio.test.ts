import { describe, expect, it } from 'vitest';
import type { MusicTrackDto } from '@cinedrive/shared';
import {
  DEFAULT_MUSIC_AUDIO_SETTINGS,
  audioQualityTier,
  formatAudioQuality,
  logicalMusicPosition,
  parseStoredAudioSettings,
  replayGainLinear,
  requiresMusicTranscode,
} from './musicAudio';

const track = (audio: MusicTrackDto['audio']): MusicTrackDto => ({
  id: 'track-1',
  title: 'Test Track',
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: false,
  streamUrl: '/api/music/tracks/track-1/stream',
  createdAt: '2026-08-09T00:00:00.000Z',
  audio,
});

describe('premium music audio helpers', () => {
  it('formats lossless high-resolution quality details', () => {
    const hiRes = track({
      codec: 'flac',
      bitDepth: 24,
      sampleRate: 96_000,
      bitrate: 2_800_000,
      lossless: true,
    });
    expect(formatAudioQuality(hiRes)).toBe('FLAC · 24-bit · 96 kHz');
    expect(audioQualityTier(hiRes)).toBe('hi_res');
  });

  it('falls back to bitrate for compressed tracks without depth and sample rate', () => {
    expect(formatAudioQuality(track({ codec: 'mp3', bitrate: 320_000 }))).toBe('MP3 · 320 kbps');
  });

  it('applies track ReplayGain before album gain and guards against clipping peaks', () => {
    const replayGainTrack = track({
      replayGainTrackDb: 6,
      replayGainTrackPeak: 0.8,
      replayGainAlbumDb: -4,
    });
    expect(replayGainLinear(replayGainTrack, true)).toBeCloseTo(1.25, 5);
    expect(replayGainLinear(replayGainTrack, false)).toBe(1);
  });

  it('selects compatibility transcoding from codec, container, mime type, or extension', () => {
    expect(requiresMusicTranscode(track({ codec: 'opus' }))).toBe(true);
    expect(requiresMusicTranscode(track({ container: 'ogg' }))).toBe(true);
    expect(
      requiresMusicTranscode({
        ...track({ codec: null }),
        source: {
          fileName: 'legacy.wma',
          mimeType: 'application/octet-stream',
          storageType: 'google_drive',
          library: { id: 'library', name: 'Music', storageType: 'google_drive' },
        },
      }),
    ).toBe(true);
    expect(requiresMusicTranscode(track({ codec: 'mp3', container: 'mp3' }))).toBe(false);
  });

  it('keeps the transcode offset in the logical playback position', () => {
    expect(logicalMusicPosition(2, true, 120)).toBe(122);
    expect(logicalMusicPosition(2, false, 120)).toBe(2);
  });

  it('sanitizes persisted crossfade and equalizer settings', () => {
    expect(
      parseStoredAudioSettings(
        JSON.stringify({
          crossfadeSeconds: 30,
          equalizerEnabled: true,
          eqPreset: 'custom',
          eqGains: [-40, -2, 0, 4, 80],
        }),
      ),
    ).toMatchObject({
      crossfadeSeconds: 10,
      equalizerEnabled: true,
      eqPreset: 'custom',
      eqGains: [-12, -2, 0, 4, 12],
    });
    expect(parseStoredAudioSettings('{broken')).toEqual(DEFAULT_MUSIC_AUDIO_SETTINGS);
  });
});

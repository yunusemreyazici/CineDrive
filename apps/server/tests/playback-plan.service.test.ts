import { describe, expect, it } from 'vitest';
import { buildPlaybackPlan } from '../src/services/playback-plan.service';

const analyzedAt = new Date();

describe('buildPlaybackPlan', () => {
  it('plays H.264/AAC MP4 directly in Safari and Chromium', () => {
    expect(
      buildPlaybackPlan({
        mediaContainer: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        mediaAnalyzedAt: analyzedAt,
      }),
    ).toMatchObject({ safari: 'direct', chromium: 'direct', analyzed: true });
  });

  it('uses HLS for Safari and full compatibility for Chromium on HEVC/EAC3 MKV', () => {
    expect(
      buildPlaybackPlan({
        mediaContainer: 'mkv',
        videoCodec: 'hevc',
        audioCodec: 'eac3',
        mediaAnalyzedAt: analyzedAt,
      }),
    ).toMatchObject({ safari: 'hls', chromium: 'full' });
  });

  it('automatically uses normalized HLS for HEVC/AAC MP4 in Safari', () => {
    expect(
      buildPlaybackPlan({
        mediaContainer: 'mp4',
        videoCodec: 'hevc',
        audioCodec: 'aac',
        mediaAnalyzedAt: analyzedAt,
      }),
    ).toMatchObject({ safari: 'hls', chromium: 'full', analyzed: true });
  });

  it('copies compatible H.264 video and converts only incompatible MKV audio in Chromium', () => {
    expect(
      buildPlaybackPlan({
        mediaContainer: 'mkv',
        videoCodec: 'h264',
        audioCodec: 'dts',
        mediaAnalyzedAt: analyzedAt,
      }),
    ).toMatchObject({ safari: 'hls', chromium: 'audio' });
  });

  it('falls back to direct probing behavior when analysis is missing', () => {
    expect(buildPlaybackPlan({})).toEqual({
      safari: 'direct',
      chromium: 'direct',
      reason: 'technical_metadata_missing',
      analyzed: false,
    });
  });
});

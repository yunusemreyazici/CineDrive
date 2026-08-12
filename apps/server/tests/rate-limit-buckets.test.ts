import { describe, expect, it } from 'vitest';
import { rateLimitBucket, rateLimitKey } from '../src/app';

describe('rate-limit buckets', () => {
  it('keeps artwork and downloads out of the regular API budget', () => {
    expect(rateLimitBucket('/api/music/artwork/cover-1?thumbnail=1')).toBe('playback');
    expect(rateLimitBucket('/api/music/tracks/track-1/download?format=original')).toBe('playback');
    expect(rateLimitBucket('/api/music/tracks')).toBe('api');
    expect(rateLimitKey('192.0.2.10', '/api/music/artwork/cover-1')).not.toBe(
      rateLimitKey('192.0.2.10', '/api/music/tracks'),
    );
  });
});

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

  it('keeps playback synchronization and Connect polling in an isolated budget', () => {
    expect(rateLimitBucket('/api/music/playback-state?clientId=ios-1')).toBe('connect');
    expect(rateLimitBucket('/api/music/playback-clients')).toBe('connect');
    expect(rateLimitBucket('/api/music/playback-clients/ios-1/commands')).toBe('connect');
    expect(rateLimitBucket('/api/music/playback-commands?clientId=ios-1')).toBe('connect');
    expect(rateLimitKey('192.0.2.10', '/api/music/playback-commands')).not.toBe(
      rateLimitKey('192.0.2.10', '/api/music/tracks'),
    );
  });
});

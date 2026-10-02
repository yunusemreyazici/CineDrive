import { describe, expect, it } from 'vitest';
import {
  musicConnectHeartbeatSchema,
  musicPlaybackCommandPollQuerySchema,
  musicPlaybackCommandSchema,
} from '../src/schemas/music.schema';

const expectedPlayback = {
  trackId: 'fd8ba84b-5adb-4d43-8d75-07d0f71b8c99',
  queueItemId: 'bc09266a-0ed4-44df-b9ac-ad285e0f0200',
};
const seek = { id: '5c9cfaa2-a373-4c66-9528-ab68e288ba39', type: 'seek', positionSeconds: 42 };

describe('Connect conditional seek contracts', () => {
  it('preserves legacy heartbeat, polling, and seek defaults', () => {
    expect(
      musicConnectHeartbeatSchema.parse({
        connectEnabled: true,
        remoteControlAllowed: true,
        isPlaying: false,
      }).supportsConditionalSeek,
    ).toBe(false);
    expect(
      musicPlaybackCommandPollQuerySchema.parse({ clientId: 'legacy' }).supportsConditionalSeek,
    ).toBe(false);
    expect(musicPlaybackCommandSchema.parse(seek).expectedPlayback).toBeUndefined();
  });

  it('accepts explicit capability and bounded track/entry preconditions', () => {
    expect(
      musicPlaybackCommandPollQuerySchema.parse({
        clientId: 'legacy',
        supportsConditionalSeek: '1',
      }).supportsConditionalSeek,
    ).toBe(true);
    expect(
      musicPlaybackCommandSchema.parse({ ...seek, expectedPlayback }).expectedPlayback,
    ).toEqual(expectedPlayback);
  });

  it.each([
    { ...seek, expectedPlayback: { trackId: expectedPlayback.trackId } },
    { ...seek, expectedPlayback: { ...expectedPlayback, queueItemId: 'arbitrary' } },
    { ...seek, expectedPlayback: { ...expectedPlayback, sql: 'ignored' } },
    { ...seek, type: 'pause', expectedPlayback },
  ])('rejects invalid or ambiguous playback preconditions', (command) => {
    expect(musicPlaybackCommandSchema.safeParse(command).success).toBe(false);
  });

  it('rejects ambiguous capability values rather than coercing false to true', () => {
    expect(
      musicPlaybackCommandPollQuerySchema.safeParse({ supportsConditionalSeek: 'false' }).success,
    ).toBe(false);
    expect(
      musicConnectHeartbeatSchema.safeParse({
        connectEnabled: true,
        remoteControlAllowed: true,
        isPlaying: false,
        supportsConditionalSeek: 'true',
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { MusicListeningSession } from './musicListeningHistory';

describe('meaningful music listening time', () => {
  const session = (duration = 240) =>
    new MusicListeningSession('event', 'track', duration, '2026-10-12T10:00:00Z');
  it('counts full listening time rather than recording once at the first threshold', () => {
    const listening = session();
    for (let second = 0; second <= 240; second++) listening.sample(second, second, true);
    expect(listening.finalize()).toMatchObject({ listenedSeconds: 240, eventId: 'event' });
    expect(listening.finalize()).toBeNull();
  });
  it('does not count a jump to the end as listening', () => {
    const listening = session();
    listening.sample(0, 0, true);
    listening.sample(239, 1, true);
    listening.sample(240, 2, true);
    expect(listening.finalize()).toBeNull();
  });
  it('excludes pause, buffering and seek discontinuities', () => {
    const listening = session();
    for (let second = 0; second <= 20; second++) listening.sample(second, second, true);
    listening.sample(20, 90, false);
    listening.sample(20, 100, true);
    listening.discontinuity();
    listening.sample(180, 101, true);
    for (let second = 1; second <= 15; second++) listening.sample(180 + second, 101 + second, true);
    expect(listening.finalize()?.listenedSeconds).toBe(35);
  });
  it('accepts short tracks only after actual playback and handles invalid samples', () => {
    const listening = session(10);
    listening.sample(NaN, 0, true);
    for (let second = 0; second <= 10; second++) listening.sample(second, second, true);
    expect(listening.finalize()?.listenedSeconds).toBe(10);
    expect(session().finalize()).toBeNull();
  });
});

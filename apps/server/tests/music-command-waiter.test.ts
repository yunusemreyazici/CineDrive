import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPlaybackCommandWaiter } from '../src/services/music-playback-command-waiter.js';

describe('Connect long-poll lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('releases timers and capacity immediately on abort', async () => {
    vi.useFakeTimers();
    const waiter = new MusicPlaybackCommandWaiter(1, 1);
    const controller = new AbortController();
    const held = waiter.wait('user:device', 15_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await held).toBe('aborted');
    expect(vi.getTimerCount()).toBe(0);
    const next = waiter.wait('user:device', 15_000);
    waiter.notify('user:device');
    expect(await next).toBe('notified');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not register an already aborted wait and preserves other device waiters', async () => {
    vi.useFakeTimers();
    const waiter = new MusicPlaybackCommandWaiter();
    const controller = new AbortController();
    controller.abort();
    expect(await waiter.wait('one', 15_000, controller.signal)).toBe('aborted');
    const one = waiter.wait('one', 15_000),
      two = waiter.wait('two', 15_000);
    waiter.notify('one');
    expect(await one).toBe('notified');
    expect(vi.getTimerCount()).toBe(1);
    waiter.close();
    expect(await two).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
    expect(await waiter.wait('three', 15_000)).toBe('closed');
  });
  it('times out and limits global/per-device waiters without leaking capacity', async () => {
    vi.useFakeTimers();
    const waiter = new MusicPlaybackCommandWaiter(2, 1);
    const one = waiter.wait('one', 100),
      two = waiter.wait('two', 100);
    expect(() => waiter.wait('one', 100)).toThrow(
      expect.objectContaining({ statusCode: 429, code: 'CONNECT_POLL_LIMIT' }),
    );
    expect(() => waiter.wait('three', 100)).toThrow(expect.objectContaining({ statusCode: 429 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(await one).toBe('timed-out');
    expect(await two).toBe('timed-out');
    const next = waiter.wait('three', 100);
    waiter.close();
    expect(await next).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedTtlCache } from '../src/utils/bounded-ttl-cache';

afterEach(() => vi.restoreAllMocks());

describe('BoundedTtlCache', () => {
  it('evicts least recently used entries without changing expiry when accessed', () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new BoundedTtlCache<string>(2, 100, 10, (value) => value.length);
    cache.set('a', 'first');
    cache.set('b', 'second');
    expect(cache.get('a')).toBe('first');
    cache.set('c', 'third');
    expect(cache.get('b')).toBeUndefined();
    now = 110;
    expect(cache.get('a')).toBeUndefined();
    cache.set('d', 'new');
    expect(cache.size).toBe(1);
    expect(cache.payloadBytes).toBe(5);
  });

  it('bounds buffer payloads and keys, replacements and oversized values', () => {
    const cache = new BoundedTtlCache<Buffer>(100, 12, 1000, (value) => value.byteLength);
    cache.set('a', Buffer.alloc(8));
    cache.set('b', Buffer.alloc(8));
    expect(cache.get('a')).toBeUndefined();
    expect(cache.payloadBytes).toBe(10);
    cache.set('b', Buffer.alloc(4));
    expect(cache.payloadBytes).toBe(6);
    cache.set('b', Buffer.alloc(13));
    expect(cache.size).toBe(0);
    expect(cache.payloadBytes).toBe(0);
    cache.set('overlong-key', Buffer.alloc(1));
    expect(cache.size).toBe(0);
  });

  it('caches null misses with a shorter TTL and prunes expired entries on insertion', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new BoundedTtlCache<string | null>(512, 1000, 100, (value) => value?.length ?? 4);
    cache.set('negative', null, 15);
    cache.set('positive', 'found');
    now = 14;
    expect(cache.get('negative')).toBeNull();
    now = 15;
    cache.set('new', 'ok');
    expect(cache.get('negative')).toBeUndefined();
    expect(cache.get('positive')).toBe('found');
    expect(cache.size).toBe(2);
    expect(cache.payloadBytes).toBeLessThanOrEqual(1000);
  });

  it('remains bounded over 10,000 distinct catalogue lookups', () => {
    const cache = new BoundedTtlCache<Buffer>(
      512,
      8 * 1024 * 1024,
      1000,
      (value) => value.byteLength,
    );
    for (let index = 0; index < 10_000; index += 1)
      cache.set(String(index), Buffer.alloc(64 * 1024));
    expect(cache.size).toBeLessThanOrEqual(512);
    expect(cache.payloadBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(cache.get('0')).toBeUndefined();
    expect(cache.get('9999')).toBeDefined();
  });
});

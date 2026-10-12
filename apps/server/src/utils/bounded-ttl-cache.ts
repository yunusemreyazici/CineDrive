/** Opportunistically pruned TTL/LRU cache; no timers or retained lifecycle handles.
 * Byte weights bound payloads, not the complete JavaScript object/heap overhead.
 */
export class BoundedTtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number; bytes: number }>();
  private bytes = 0;

  public constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly ttlMs: number,
    private readonly weigh: (value: T) => number,
  ) {}

  public get size() {
    return this.entries.size;
  }
  public get payloadBytes() {
    return this.bytes;
  }

  public get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.remove(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: T, ttlMs = this.ttlMs): void {
    const now = Date.now();
    for (const [existingKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(existingKey);
    }
    this.remove(key);
    const bytes = key.length * 2 + this.weigh(value);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes || ttlMs <= 0) return;
    this.entries.set(key, { value, expiresAt: now + ttlMs, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}

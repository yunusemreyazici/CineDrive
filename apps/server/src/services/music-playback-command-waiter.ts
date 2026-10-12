type WaitResult = 'notified' | 'timed-out' | 'aborted' | 'closed';

export class MusicPlaybackCommandWaiter {
  private readonly waiters = new Map<string, Set<(result: WaitResult) => void>>();
  private count = 0;
  private closed = false;

  constructor(
    private readonly maxWaiters = 4096,
    private readonly maxPerDevice = 8,
  ) {}

  public wait(key: string, timeoutMs: number, signal?: AbortSignal): Promise<WaitResult> {
    if (this.closed) return Promise.resolve('closed');
    if (signal?.aborted) return Promise.resolve('aborted');
    if (timeoutMs <= 0) return Promise.resolve('timed-out');
    if (this.count >= this.maxWaiters || (this.waiters.get(key)?.size ?? 0) >= this.maxPerDevice) {
      throw Object.assign(
        new Error('Çok fazla eşzamanlı Connect isteği. Daha sonra tekrar deneyin.'),
        { statusCode: 429, code: 'CONNECT_POLL_LIMIT' },
      );
    }
    return new Promise<WaitResult>((resolve) => {
      const callbacks = this.waiters.get(key) ?? new Set<(result: WaitResult) => void>();
      let settled = false;
      const finish = (result: WaitResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        callbacks.delete(finish);
        this.count--;
        if (callbacks.size === 0) this.waiters.delete(key);
        resolve(result);
      };
      const onAbort = () => finish('aborted');
      const timer = setTimeout(() => finish('timed-out'), timeoutMs);
      callbacks.add(finish);
      this.count++;
      this.waiters.set(key, callbacks);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  public notify(key: string) {
    for (const finish of [...(this.waiters.get(key) ?? [])]) finish('notified');
  }

  public close() {
    this.closed = true;
    for (const callbacks of this.waiters.values()) {
      for (const finish of [...callbacks]) finish('closed');
    }
  }
}

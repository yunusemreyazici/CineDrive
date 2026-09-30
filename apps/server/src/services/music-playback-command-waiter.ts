export class MusicPlaybackCommandWaiter {
  private readonly waiters = new Map<string, Set<() => void>>();

  public async wait(key: string, timeoutMs: number) {
    if (timeoutMs <= 0) return;
    await new Promise<void>((resolve) => {
      const callbacks = this.waiters.get(key) ?? new Set<() => void>();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callbacks.delete(finish);
        if (callbacks.size === 0) this.waiters.delete(key);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      callbacks.add(finish);
      this.waiters.set(key, callbacks);
    });
  }

  public notify(key: string) {
    for (const finish of [...(this.waiters.get(key) ?? [])]) finish();
  }

  public close() {
    for (const callbacks of this.waiters.values()) {
      for (const finish of [...callbacks]) finish();
    }
  }
}

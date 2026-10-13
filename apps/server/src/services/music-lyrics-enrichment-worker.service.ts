/** Periodic bounded maintenance, independent of HTTP requests and language.
 * Delay startup, never overlap runs, and drain started provider work on shutdown.
 */
export class MusicLyricsEnrichmentWorker {
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private started = false;
  private stopped = false;
  private retryMs = 30_000;

  constructor(
    private readonly run: (signal: AbortSignal) => Promise<unknown>,
    private readonly intervalMs: number,
    private readonly onError: () => void = () => {},
  ) {}

  start() {
    if (this.started || this.stopped || this.intervalMs <= 0) return;
    this.started = true;
    this.schedule(30_000);
  }

  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped) return;
      const controller = new AbortController();
      this.controller = controller;
      this.active = Promise.resolve()
        .then(() => this.run(controller.signal))
        .then(
          () => {
            this.retryMs = 30_000;
            if (!this.stopped) this.schedule(this.intervalMs);
          },
          () => {
            if (!this.stopped) {
              this.onError();
              this.schedule(this.retryMs);
              this.retryMs = Math.min(this.retryMs * 2, 300_000);
            }
          },
        )
        .finally(() => {
          this.active = undefined;
          this.controller = undefined;
        });
    }, delay);
    this.timer.unref();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.active;
  }
}

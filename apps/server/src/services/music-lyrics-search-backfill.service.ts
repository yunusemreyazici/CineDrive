const INITIAL_RETRY_MS = 30_000;
const MAX_RETRY_MS = 5 * 60_000;

/** One provider-free index worker per server. Never await this from a startup
 * hook: schedule after listen, and drain its current batch before DB shutdown.
 */
export class MusicLyricsSearchBackfillService {
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private started = false;
  private stopped = false;
  private retryDelay = INITIAL_RETRY_MS;

  constructor(
    private readonly run: (signal: AbortSignal) => Promise<void>,
    private readonly onComplete: () => void = () => {},
    private readonly onError: () => void = () => {},
  ) {}

  public start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }

  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped) return;
      const controller = new AbortController();
      this.controller = controller;
      const work = Promise.resolve().then(() => this.run(controller.signal));
      this.active = work;
      void work.then(
        () => {
          this.active = undefined;
          this.controller = undefined;
          if (!this.stopped) this.onComplete();
        },
        () => {
          this.active = undefined;
          this.controller = undefined;
          if (this.stopped) return;
          this.onError();
          this.schedule(this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
        },
      );
    }, delay);
    this.timer.unref();
  }

  public async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.active?.catch(() => {});
  }
}

/** Read-only observation. Scheduling, cancellation and provider backoff stay with each worker. */
export class BackgroundJobObservation {
  private state = 'idle';
  private startedAt: string | null = null;
  private completedAt: string | null = null;
  private nextRunAt: string | null = null;
  private failures = 0;
  scheduled(delay: number) {
    this.nextRunAt = new Date(Date.now() + delay).toISOString();
    if (this.state !== 'retryWaiting') this.state = 'queued';
  }
  begin() {
    this.state = 'running';
    this.startedAt = new Date().toISOString();
    this.nextRunAt = null;
  }
  complete() {
    this.state = 'completed';
    this.completedAt = new Date().toISOString();
  }
  fail() {
    this.state = 'retryWaiting';
    this.failures += 1;
    this.completedAt = new Date().toISOString();
  }
  stop() {
    this.state = 'stopped';
    this.nextRunAt = null;
  }
  snapshot() {
    return {
      status: this.state,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      nextRunAt: this.nextRunAt,
      failures: this.failures,
      estimatedRemainingSeconds: null,
    };
  }
}

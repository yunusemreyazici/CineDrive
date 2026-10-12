import type { Prisma, PrismaClient } from '@cinedrive/prisma';

export const CONNECT_COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CONNECT_COMMAND_CLEANUP_BATCH_SIZE = 400;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Protocol receipts, not listening history. Keep seven days after both expiry
 * and any terminal acknowledgement; one bounded batch avoids long writer locks. */
export class MusicConnectMaintenanceService {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<number>;
  private stopped = false;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
    private readonly onError: () => void = () => {},
  ) {}

  public run(): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    if (this.active) return this.active;
    const work = this.cleanup();
    this.active = work;
    void work.then(
      () => {
        if (this.active === work) this.active = undefined;
      },
      () => {
        if (this.active === work) this.active = undefined;
      },
    );
    return work;
  }

  private async cleanup() {
    const cutoff = new Date(this.clock().getTime() - CONNECT_COMMAND_RETENTION_MS);
    const where: Prisma.MusicPlaybackCommandWhereInput = {
      expiresAt: { lt: cutoff },
      OR: [{ completedAt: null }, { completedAt: { lt: cutoff } }],
    };
    const ids = await this.prisma.musicPlaybackCommand.findMany({
      where,
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: CONNECT_COMMAND_CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    if (ids.length === 0 || this.stopped) return 0;
    // A concurrent late ACK must still be retained for its full retry window.
    const result = await this.prisma.musicPlaybackCommand.deleteMany({
      where: { ...where, id: { in: ids.map((command) => command.id) } },
    });
    return result.count;
  }

  public start() {
    if (this.stopped || this.timer) return;
    const tick = () => {
      void this.run().catch(() => this.onError());
    };
    this.timer = setInterval(tick, CLEANUP_INTERVAL_MS);
    this.timer.unref();
    tick();
  }

  public async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active?.catch(() => {});
  }
}

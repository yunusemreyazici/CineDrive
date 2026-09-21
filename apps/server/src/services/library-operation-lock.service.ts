import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@cinedrive/prisma';

export type LibraryOperationKind = 'scan' | 'clear' | 'delete' | 'source-unlink' | 'database-clear';

const LOCK_TTL_MS = 10 * 60 * 1000;

export interface LibraryOperationLock {
  readonly token: string;
  heartbeat(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Serializes operations that can invalidate or replace a library catalogue.
 *
 * The lease lives on Library rather than in process memory so a second server
 * process cannot start a scan while another process clears the same library.
 * Expiration makes a crashed process recoverable; the token prevents that
 * crashed process from releasing a lock acquired by its successor.
 */
export class LibraryOperationLockService {
  constructor(private readonly prisma: PrismaClient) {}

  public async acquire(
    libraryId: string,
    kind: LibraryOperationKind,
  ): Promise<LibraryOperationLock> {
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    const result = await this.prisma.library.updateMany({
      where: {
        id: libraryId,
        OR: [
          { operationLockToken: null },
          { operationLockExpiresAt: null },
          { operationLockExpiresAt: { lt: now } },
        ],
      },
      data: {
        operationLockKind: kind,
        operationLockToken: token,
        operationLockExpiresAt: expiresAt,
      },
    });

    if (result.count !== 1) {
      throw new Error('LIBRARY_OPERATION_IN_PROGRESS');
    }

    return {
      token,
      heartbeat: () => this.heartbeat(libraryId, token),
      release: () => this.release(libraryId, token),
    };
  }

  private async heartbeat(libraryId: string, token: string): Promise<boolean> {
    const result = await this.prisma.library.updateMany({
      where: { id: libraryId, operationLockToken: token },
      data: { operationLockExpiresAt: new Date(Date.now() + LOCK_TTL_MS) },
    });
    return result.count === 1;
  }

  private async release(libraryId: string, token: string): Promise<void> {
    await this.prisma.library.updateMany({
      where: { id: libraryId, operationLockToken: token },
      data: {
        operationLockKind: null,
        operationLockToken: null,
        operationLockExpiresAt: null,
      },
    });
  }
}

import type { Prisma, PrismaClient } from '@cinedrive/prisma';

/** Shared user/device/status scope for heartbeat revocation and device removal. */
export function failPendingMusicConnectCommands(
  tx: Prisma.TransactionClient,
  userId: string,
  clientId: string,
  reason: 'REMOTE_CONTROL_DISABLED' | 'CONNECT_DISABLED' | 'DEVICE_REMOVED',
) {
  return tx.musicPlaybackCommand.updateMany({
    where: { userId, targetClientId: clientId, status: 'pending' },
    data: { status: 'failed', errorMessage: reason, completedAt: new Date() },
  });
}

interface EnqueueMusicConnectCommand {
  id: string;
  userId: string;
  sourceClientId: string;
  targetClientId: string;
  type: string;
  payload: string | null;
}

type EnqueueResult =
  | { kind: 'rejected'; code: 'DEVICE_CONTROL_DISABLED' | 'DEVICE_OFFLINE' | 'COMMAND_ID_CONFLICT' }
  | { kind: 'created' | 'existing'; command: { id: string; status: string } };

/** Serialize the final permission read and enqueue against heartbeat revocation.
 * No network requests or metadata hydration belong inside this short write transaction. */
export async function enqueueMusicConnectCommand(
  prisma: PrismaClient,
  input: EnqueueMusicConnectCommand,
): Promise<EnqueueResult> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.musicPlaybackState.findUnique({
      where: { userId_clientId: { userId: input.userId, clientId: input.targetClientId } },
      select: { connectEnabled: true, remoteControlAllowed: true, lastSeenAt: true },
    });
    if (!target?.connectEnabled || !target.remoteControlAllowed) {
      return { kind: 'rejected', code: 'DEVICE_CONTROL_DISABLED' };
    }
    if (!target.lastSeenAt || target.lastSeenAt.getTime() < Date.now() - 30_000) {
      return { kind: 'rejected', code: 'DEVICE_OFFLINE' };
    }
    const duplicate = await tx.musicPlaybackCommand.findUnique({ where: { id: input.id } });
    if (duplicate) {
      if (duplicate.userId !== input.userId)
        return { kind: 'rejected', code: 'COMMAND_ID_CONFLICT' };
      return { kind: 'existing', command: { id: duplicate.id, status: duplicate.status } };
    }
    const command = await tx.musicPlaybackCommand.create({
      data: { ...input, expiresAt: new Date(Date.now() + 45_000) },
      select: { id: true, status: true },
    });
    return { kind: 'created', command };
  });
}

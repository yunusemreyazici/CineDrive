import type { Prisma, PrismaClient } from '@cinedrive/prisma';

interface AcknowledgeMusicConnectCommand {
  id: string;
  userId: string;
  clientId: string;
  status: 'completed' | 'failed';
  errorMessage?: string;
}

/** A result is immutable once stored. Accept an identical retry after a lost
 * response, without overwriting a revocation or exposing another user's command. */
export async function acknowledgeMusicConnectCommand(
  prisma: PrismaClient,
  input: AcknowledgeMusicConnectCommand,
): Promise<'acknowledged' | 'missing' | 'conflict'> {
  const scope = { id: input.id, userId: input.userId, targetClientId: input.clientId };
  const errorMessage = input.errorMessage ?? null;
  const updated = await prisma.musicPlaybackCommand.updateMany({
    where: { ...scope, status: 'pending' },
    data: { status: input.status, errorMessage, completedAt: new Date() },
  });
  if (updated.count) return 'acknowledged';
  const existing = await prisma.musicPlaybackCommand.findFirst({
    where: scope,
    select: { status: true, errorMessage: true },
  });
  if (!existing) return 'missing';
  return existing.status === input.status && existing.errorMessage === errorMessage
    ? 'acknowledged'
    : 'conflict';
}

/** Shared user/device/status scope for heartbeat revocation and device removal. */
export function failPendingMusicConnectCommands(
  tx: Prisma.TransactionClient,
  userId: string,
  clientId: string,
  reason:
    | 'REMOTE_CONTROL_DISABLED'
    | 'CONNECT_DISABLED'
    | 'DEVICE_REMOVED'
    | 'CONDITIONAL_SEEK_UNSUPPORTED',
) {
  return tx.musicPlaybackCommand.updateMany({
    where: {
      userId,
      targetClientId: clientId,
      status: 'pending',
      ...(reason === 'CONDITIONAL_SEEK_UNSUPPORTED' ? { requiresConditionalSeek: true } : {}),
    },
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
  expectedPlayback?: { trackId: string; queueItemId: string };
}

type EnqueueResult =
  | {
      kind: 'rejected';
      code:
        | 'DEVICE_CONTROL_DISABLED'
        | 'DEVICE_OFFLINE'
        | 'COMMAND_ID_CONFLICT'
        | 'CONDITIONAL_SEEK_UNSUPPORTED'
        | 'PLAYBACK_ITEM_CHANGED';
    }
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
      select: {
        connectEnabled: true,
        remoteControlAllowed: true,
        lastSeenAt: true,
        supportsConditionalSeek: true,
        currentTrackId: true,
        currentQueueItemId: true,
      },
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
      if (
        input.expectedPlayback &&
        (!duplicate.requiresConditionalSeek ||
          duplicate.payload !== input.payload ||
          duplicate.targetClientId !== input.targetClientId ||
          duplicate.type !== input.type)
      ) {
        return { kind: 'rejected', code: 'COMMAND_ID_CONFLICT' };
      }
      return { kind: 'existing', command: { id: duplicate.id, status: duplicate.status } };
    }
    if (input.expectedPlayback) {
      if (!target.supportsConditionalSeek)
        return { kind: 'rejected', code: 'CONDITIONAL_SEEK_UNSUPPORTED' };
      if (
        target.currentTrackId !== input.expectedPlayback.trackId ||
        target.currentQueueItemId !== input.expectedPlayback.queueItemId
      ) {
        return { kind: 'rejected', code: 'PLAYBACK_ITEM_CHANGED' };
      }
    }
    const { expectedPlayback, ...data } = input;
    const command = await tx.musicPlaybackCommand.create({
      data: {
        ...data,
        requiresConditionalSeek: !!expectedPlayback,
        expiresAt: new Date(Date.now() + 45_000),
      },
      select: { id: true, status: true },
    });
    return { kind: 'created', command };
  });
}

import type { PrismaClient } from '@cinedrive/prisma';
import { describe, expect, it } from 'vitest';
import { enqueueMusicConnectCommand } from '../src/services/music-connect-command.service.js';

describe('Connect immutable command identity', () => {
  const input = {
    id: 'command',
    userId: 'user',
    sourceClientId: 'source',
    targetClientId: 'target',
    type: 'pause',
    payload: null as string | null,
  };
  const enqueue = (
    changes: Partial<typeof input> & {
      expectedPlayback?: { trackId: string; queueItemId: string };
    },
  ) => {
    const tx = {
      musicPlaybackState: {
        findUnique: async () => ({
          connectEnabled: true,
          remoteControlAllowed: true,
          lastSeenAt: new Date(),
        }),
      },
      musicPlaybackCommand: {
        findUnique: async () => ({ ...input, requiresConditionalSeek: false, status: 'completed' }),
      },
    };
    const prisma = {
      $transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as PrismaClient;
    return enqueueMusicConnectCommand(prisma, { ...input, ...changes });
  };
  it('accepts the identical retry', async () => {
    expect((await enqueue({})).kind).toBe('existing');
  });
  it.each([
    { sourceClientId: 'other' },
    { targetClientId: 'other' },
    { type: 'next' },
    { payload: '{"volume":0.5}' },
    { userId: 'other' },
    { expectedPlayback: { trackId: 'track', queueItemId: 'item' } },
  ])('rejects changed identity %j', async (changes) => {
    expect(await enqueue(changes)).toEqual({ kind: 'rejected', code: 'COMMAND_ID_CONFLICT' });
  });
});

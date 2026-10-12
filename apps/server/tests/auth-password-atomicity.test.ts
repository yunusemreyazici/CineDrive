import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../src/generated/prisma/client.js';
import { buildApp } from '../src/app.js';

describe('atomic password changes', () => {
  let app: FastifyInstance;
  const password = 'Only-A-Test-Password-123!';
  let originalHash: string;
  let nextHash: string;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    originalHash = await app.authService.hashPassword(password);
    nextHash = await app.authService.hashPassword('Next-Test-Password-123!');
  });
  afterAll(async () => {
    await app.close();
  });
  const fixture = async () => {
    const user = await app.prisma.user.create({
      data: {
        email: `${randomUUID()}@password.test`,
        name: 'Fixture',
        passwordHash: originalHash,
      },
    });
    await app.prisma.session.create({
      data: {
        userId: user.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return user;
  };

  it.each(['password-update', 'session-delete', 'session-create'] as const)(
    'rolls back password and sessions when %s fails',
    async (step) => {
      const user = await fixture();
      const transaction = app.prisma.$transaction.bind(app.prisma);
      const implementation = (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        transaction(async (tx) =>
          work(
            new Proxy(tx, {
              get(target, property) {
                if (property === 'user' || property === 'session') {
                  const delegate = Reflect.get(target, property);
                  return new Proxy(delegate, {
                    get(model, method) {
                      if (
                        (property === 'user' &&
                          method === 'updateMany' &&
                          step === 'password-update') ||
                        (property === 'session' &&
                          method === 'deleteMany' &&
                          step === 'session-delete') ||
                        (property === 'session' && method === 'create' && step === 'session-create')
                      ) {
                        return () => Promise.reject(new Error('INJECTED_FAILURE'));
                      }
                      return Reflect.get(model, method);
                    },
                  });
                }
                return Reflect.get(target, property);
              },
            }),
          ),
        );
      const spy = vi
        .spyOn(app.prisma, '$transaction')
        .mockImplementationOnce(implementation as typeof app.prisma.$transaction);
      const hash = vi.spyOn(app.authService, 'hashPassword').mockResolvedValue(nextHash);
      try {
        await expect(app.authService.changePassword(user.id, password, 'next')).rejects.toThrow(
          'INJECTED_FAILURE',
        );
        expect(
          (await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
        ).toBe(originalHash);
        expect(await app.prisma.session.count({ where: { userId: user.id } })).toBe(1);
      } finally {
        spy.mockRestore();
        hash.mockRestore();
        await app.prisma.user.delete({ where: { id: user.id } });
      }
    },
  );

  it.each(['reset', 'disable'] as const)(
    'rejects a concurrent %s without overwriting it',
    async (action) => {
      const user = await fixture();
      const hash = vi.spyOn(app.authService, 'hashPassword').mockImplementationOnce(async () => {
        await app.prisma.user.update({
          where: { id: user.id },
          data: action === 'reset' ? { passwordHash: nextHash } : { disabledAt: new Date() },
        });
        return originalHash;
      });
      try {
        await expect(app.authService.changePassword(user.id, password, 'next')).rejects.toThrow(
          'INVALID_CURRENT_PASSWORD',
        );
        const current = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(current.passwordHash).toBe(action === 'reset' ? nextHash : originalHash);
        expect(Boolean(current.disabledAt)).toBe(action === 'disable');
        expect(await app.prisma.session.count({ where: { userId: user.id } })).toBe(1);
      } finally {
        hash.mockRestore();
        await app.prisma.user.delete({ where: { id: user.id } });
      }
    },
  );

  it('revokes all old sessions and creates exactly one usable new session', async () => {
    const user = await fixture();
    const previous = await app.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const hash = vi.spyOn(app.authService, 'hashPassword').mockResolvedValue(nextHash);
    try {
      const result = await app.authService.changePassword(user.id, password, 'next');
      expect(await app.authService.getSessionUser(previous.token)).toBeNull();
      expect((await app.authService.getSessionUser(result.sessionToken))?.id).toBe(user.id);
      expect(await app.prisma.session.count({ where: { userId: user.id } })).toBe(1);
      expect(
        await argon2.verify(
          (await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash!,
          'Next-Test-Password-123!',
        ),
      ).toBe(true);
    } finally {
      hash.mockRestore();
      await app.prisma.user.delete({ where: { id: user.id } });
    }
  });
});

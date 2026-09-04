import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import { validateLocalFolder } from '../src/services/local-folder-validation';

describe('local folder access validation', () => {
  let app: FastifyInstance;
  let directory: string;
  let cookie: string;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-folder-check-'));
    app = await buildApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
  });
  afterAll(async () => {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const check = (payload: unknown, authenticated = true) =>
    app.inject({
      method: 'POST',
      url: '/api/libraries/validate-local',
      payload: payload as Record<string, string>,
      cookies: authenticated ? { session_id: cookie } : {},
    });

  it('requires authentication before inspecting the filesystem', async () => {
    const spy = vi.spyOn(fs, 'opendir');
    try {
      expect((await check({ localFolderPath: directory }, false)).statusCode).toBe(401);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it('rejects a normal user without inspecting the filesystem', async () => {
    const admin = await app.authService.getSessionUser(cookie);
    const session = vi
      .spyOn(app.authService, 'getSessionUser')
      .mockResolvedValue({ ...admin!, role: 'user' });
    const spy = vi.spyOn(fs, 'opendir');
    try {
      expect((await check({ localFolderPath: directory })).statusCode).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      session.mockRestore();
      spy.mockRestore();
    }
  });
  it('accepts an accessible empty directory without creating a library or reading files', async () => {
    const before = await app.prisma.library.count();
    const read = vi.spyOn(fs, 'readFile');
    try {
      const response = await check({ localFolderPath: directory });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ validation: { readable: true } });
      expect(read).not.toHaveBeenCalled();
      expect(await app.prisma.library.count()).toBe(before);
    } finally {
      read.mockRestore();
    }
  });
  it('rejects invalid, relative, missing and non-directory paths without disclosing paths', async () => {
    const file = path.join(directory, 'private-file');
    await fs.writeFile(file, 'private content');
    for (const value of [
      '',
      'relative/path',
      `${directory}/missing`,
      file,
      '\0',
      'x'.repeat(4097),
    ]) {
      const response = await check({ localFolderPath: value });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(directory);
      expect(response.body).not.toContain('private content');
      expect(response.body).not.toContain('ENOENT');
      expect(response.json().error.requestId).toBeTruthy();
    }
  });
  it('sanitizes permission and unexpected filesystem failures', async () => {
    const spy = vi
      .spyOn(fs, 'access')
      .mockRejectedValue(new Error('EACCES internal-private-implementation'));
    try {
      const response = await check({ localFolderPath: directory });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('internal-private-implementation');
      expect(response.body).not.toContain('EACCES');
    } finally {
      spy.mockRestore();
    }
  });
  it('always closes the directory handle after a successful access check', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const open = vi
      .spyOn(fs, 'opendir')
      .mockResolvedValue({ close } as unknown as Awaited<ReturnType<typeof fs.opendir>>);
    try {
      await validateLocalFolder(directory);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      open.mockRestore();
    }
  });
});

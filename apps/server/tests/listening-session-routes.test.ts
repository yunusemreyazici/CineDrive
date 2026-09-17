import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, rateLimitBucket } from '../src/app.js';
import { env } from '../src/config/env.js';

describe('Listening session HTTP and WebSocket', () => {
  let app: FastifyInstance;
  let hostCookie: string;
  let guestCookie: string;
  let guestId: string;
  let libraryId: string;
  let trackId: string;
  const cookies = (value: string) => ({ session_id: value });
  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    const host = await app.authService.ensureAdminUserExists();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    hostCookie = login.cookies.find((c) => c.name === 'session_id')!.value;
    const email = `listen-${randomUUID()}@example.test`;
    const guest = await app.authService.createUser({
      email,
      name: 'Guest',
      password: 'a-long-test-password',
      role: 'user',
    });
    guestId = guest.id;
    const guestLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'a-long-test-password' },
    });
    guestCookie = guestLogin.cookies.find((c) => c.name === 'session_id')!.value;
    const library = await app.prisma.library.create({
      data: {
        userId: host.id,
        name: 'Listen test',
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: '/tmp',
      },
    });
    libraryId = library.id;
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId,
        storageType: 'local',
        localFilePath: `/tmp/listen-${randomUUID()}.mp3`,
        name: 'Song.mp3',
        mimeType: 'audio/mpeg',
        size: 100n,
        status: 'active',
      },
    });
    const track = await app.prisma.musicTrack.create({
      data: {
        libraryId,
        driveFileId: file.id,
        title: 'Song',
        normalizedTitle: 'song',
        duration: 100,
      },
    });
    trackId = track.id;
  });
  afterEach(async () => {
    await app.prisma.library.deleteMany({ where: { id: libraryId } });
    await app.prisma.user.deleteMany({ where: { id: guestId } });
    await app.close();
  });
  const create = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/music/listening-sessions',
      cookies: cookies(hostCookie),
      payload: { clientId: 'mac', trackIds: [trackId], playing: true },
    });
    expect(response.statusCode).toBe(200);
    return response.json().session;
  };
  it('requires authentication and validates input, with a separate rate bucket', async () => {
    expect(rateLimitBucket('/api/music/listening-sessions/room/events')).toBe('connect');
    const denied = await app.inject({
      method: 'POST',
      url: '/api/music/listening-sessions',
      payload: { clientId: 'mac', trackIds: [trackId] },
    });
    expect(denied.statusCode).toBe(401);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/music/listening-sessions',
      cookies: cookies(hostCookie),
      payload: { clientId: 'mac', trackIds: [], position: -1 },
    });
    expect(invalid.statusCode).toBe(400);
  });
  it('joins only after a library grant and scopes state to account AND device', async () => {
    const session = await create();
    const join = () =>
      app.inject({
        method: 'POST',
        url: '/api/music/listening-sessions/join',
        cookies: cookies(guestCookie),
        payload: { clientId: 'phone', code: session.inviteCode },
      });
    expect((await join()).statusCode).toBe(403);
    await app.prisma.libraryMembership.create({ data: { libraryId, userId: guestId } });
    const accepted = await join();
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().tracks[0].id).toBe(trackId);
    expect(accepted.json().session.inviteCode).toBeNull();
    const wrongDevice = await app.inject({
      method: 'GET',
      url: `/api/music/listening-sessions/${session.id}?clientId=mac`,
      cookies: cookies(guestCookie),
    });
    expect(wrongDevice.statusCode).toBe(404);
    await app.prisma.libraryMembership.deleteMany({ where: { libraryId, userId: guestId } });
    const revoked = await app.inject({
      method: 'GET',
      url: `/api/music/listening-sessions/${session.id}?clientId=phone`,
      cookies: cookies(guestCookie),
    });
    expect(revoked.statusCode).toBe(403);
  });
  it('pushes queue changes over an authenticated socket and permits reconnect', async () => {
    const session = await create();
    const path = `/api/music/listening-sessions/${session.id}/events?clientId=mac`;
    const upgradeContext = (headers: Record<string, string> = {}) => {
      const socket = new Socket();
      Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
      return { socket, headers: { host: 'localhost', ...headers } };
    };
    await expect(app.injectWS(path, upgradeContext())).rejects.toThrow();
    await expect(
      app.injectWS(
        path,
        upgradeContext({ cookie: `session_id=${hostCookie}`, origin: 'https://evil.example' }),
      ),
    ).rejects.toThrow();
    const messages: string[] = [];
    const socket = await app.injectWS(
      path,
      upgradeContext({ cookie: `session_id=${hostCookie}` }),
      {
        onInit: (ws) => ws.on('message', (message) => messages.push(message.toString())),
      },
    );
    const changed = once(socket, 'message');
    const result = await app.inject({
      method: 'POST',
      url: `/api/music/listening-sessions/${session.id}/commands`,
      cookies: cookies(hostCookie),
      payload: { clientId: 'mac', action: 'add', trackIds: [trackId], revision: session.revision },
    });
    expect(result.statusCode).toBe(200);
    await changed;
    expect(messages.some((m) => JSON.parse(m).type === 'changed')).toBe(true);
    socket.close();
    await once(socket, 'close');
    const reconnect = await app.injectWS(
      path,
      upgradeContext({ cookie: `session_id=${hostCookie}` }),
    );
    reconnect.close();
    await once(reconnect, 'close');
    const final = await app.inject({
      method: 'GET',
      url: `/api/music/listening-sessions/${session.id}?clientId=mac`,
      cookies: cookies(hostCookie),
    });
    expect(final.json().session.queue).toHaveLength(2);
  });
});

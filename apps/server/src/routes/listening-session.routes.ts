import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ListeningSessionService,
  listenError,
  type Listener,
} from '../services/listening-session.service.js';
import { findMusicTracksWithRelations, formatMusicTrack } from '../utils/music-format.js';

const clientId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const identifiers = z.array(z.string().min(1).max(128)).min(1).max(250);
const memberBody = z.object({ clientId });
const commandBody = memberBody.extend({
  revision: z.number().int().nonnegative(),
  playNext: z.boolean().optional(),
  action: z.enum(['play', 'pause', 'seek', 'next', 'previous', 'replace', 'add', 'remove']),
  trackIds: identifiers.optional(),
  index: z.number().int().nonnegative().optional(),
  position: z.number().finite().min(0).max(86400).optional(),
  itemId: z.string().max(128).optional(),
});
const accessWhere = (userId: string, ids: string[]) => ({
  id: { in: ids },
  driveFile: { status: 'active' },
  library: { OR: [{ userId }, { memberships: { some: { userId } } }] },
});
export const listeningSessionRoutes: FastifyPluginAsync = async (app) => {
  const service = new ListeningSessionService(
    async (userId, ids) =>
      (await app.prisma.musicTrack.count({ where: accessWhere(userId, ids) })) === ids.length,
  );
  const watchers = new Map<string, Set<() => void>>();
  service.onChange = (id) => watchers.get(id)?.forEach((notify) => notify());
  const sweeper = setInterval(() => service.sweep(), 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    service.close();
    watchers.clear();
  });
  app.addHook('preHandler', app.authenticate);
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof z.ZodError ? 400 : ((error as { statusCode?: number }).statusCode ?? 500);
    reply.code(status).send({
      error: {
        code: 'LISTEN_SESSION',
        requestId: request.id,
        message:
          status === 400
            ? 'Geçersiz dinleme oturumu isteği.'
            : status >= 500
              ? 'Dinleme oturumu güncellenemedi.'
              : (error as Error).message,
      },
    });
  });

  const member = (req: FastifyRequest, id: string): Listener => ({
    userId: req.user!.id,
    name: req.user!.name,
    clientId: id,
  });
  const roomId = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;
  const payload = async (id: string, who: Listener) => {
    const session = await service.read(id, who);
    const ids = [...new Set(session.queue.map((e) => e.trackId))];
    const tracks = await findMusicTracksWithRelations(app.prisma, who.userId, {
      where: accessWhere(who.userId, ids),
      orderBy: { id: 'asc' },
    });
    if (tracks.length !== ids.length)
      throw listenError(403, 'Kuyruktaki bir parçaya artık erişilemiyor.');
    return { session, tracks: tracks.map(formatMusicTrack) };
  };
  app.post('/', async (req) => {
    const body = memberBody
      .extend({
        trackIds: identifiers,
        index: z.number().int().min(0).default(0),
        position: z.number().finite().min(0).max(86400).default(0),
        playing: z.boolean().default(false),
      })
      .parse(req.body);
    const who = member(req, body.clientId);
    const id = await service.create(who, body.trackIds, body.index, body.position, body.playing);
    return payload(id, who);
  });
  app.post(
    '/join',
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: '1 minute',
          keyGenerator: (req) => `${req.ip}:listen-invite`,
        },
      },
    },
    async (req) => {
      const body = memberBody.extend({ code: z.string().regex(/^[A-F0-9]{16}$/) }).parse(req.body);
      const who = member(req, body.clientId);
      return payload(await service.join(who, body.code), who);
    },
  );
  app.get('/:id', async (req) => {
    const query = memberBody.parse(req.query);
    return payload(roomId(req), member(req, query.clientId));
  });
  app.post('/:id/commands', async (req) => {
    const body = commandBody.parse(req.body);
    const who = member(req, body.clientId);
    await service.mutate(roomId(req), who, body);
    return payload(roomId(req), who);
  });
  app.post('/:id/ready', async (req) => {
    const body = memberBody.extend({ epoch: z.number().int().nonnegative() }).parse(req.body);
    const who = member(req, body.clientId);
    await service.ready(roomId(req), who, body.epoch);
    return payload(roomId(req), who);
  });
  app.post('/:id/leave', async (req) => {
    const body = memberBody.parse(req.body);
    await service.leave(roomId(req), member(req, body.clientId));
    return { ok: true };
  });
  app.get(
    '/:id/events',
    {
      websocket: true,
      preValidation: async (req) => {
        if (!req.user) throw listenError(401, 'Oturum açmanız gerekiyor.');
        // Native clients have no Origin. Browser connections must match the host;
        // cookie authentication must not permit cross-site WebSocket hijacking.
        if (req.headers.origin) {
          let host: string;
          try {
            host = new URL(req.headers.origin).host;
          } catch {
            throw listenError(403, 'Geçersiz kaynak.');
          }
          if (host !== req.headers.host) throw listenError(403, 'Geçersiz kaynak.');
        }
        const query = memberBody.parse(req.query);
        await service.read(roomId(req), member(req, query.clientId));
      },
    },
    (socket, req) => {
      const id = roomId(req);
      const who = member(req, memberBody.parse(req.query).clientId);
      const notify = () => {
        if (socket.readyState !== 1) return;
        if (socket.bufferedAmount > 8192) {
          socket.close(1013, 'Slow connection');
          return;
        }
        socket.send(JSON.stringify({ type: 'changed' }));
      };
      const set = watchers.get(id) ?? new Set();
      // Prevent a single room/account from accumulating unbounded sockets.
      if (set.size >= 8) {
        socket.close(1008, 'Too many connections');
        return;
      }
      set.add(notify);
      watchers.set(id, set);
      service.connectionChanged(id, who, true);
      let alive = true;
      let checking = false;
      socket.on('pong', () => {
        alive = true;
      });
      socket.on('message', () => {
        socket.close(1008, 'Use authenticated HTTP commands');
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        if (checking) return;
        alive = false;
        socket.ping();
        checking = true;
        void (async () => {
          try {
            const user = req.sessionToken
              ? await app.authService.getSessionUser(req.sessionToken)
              : null;
            if (!user || user.id !== who.userId) throw listenError(401, 'Session expired');
            await service.read(id, who);
            notify();
          } catch {
            socket.close(1008, 'Session unavailable');
          } finally {
            checking = false;
          }
        })();
      }, 20_000);
      heartbeat.unref();
      socket.on('close', () => {
        clearInterval(heartbeat);
        set.delete(notify);
        service.connectionChanged(id, who, false);
        if (!set.size) watchers.delete(id);
      });
      socket.on('error', () => socket.close());
      notify();
    },
  );
};

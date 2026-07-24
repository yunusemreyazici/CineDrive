import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, updateProfileSchema, changePasswordSchema, type LoginInput, type UserDto } from '@cinedrive/shared';
import { env } from '../config/env.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/auth/login (Brute-force protection: max 5 requests per minute per IP)
  fastify.post<{ Body: LoginInput }>(
    '/login',
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === 'test' ? 1000 : 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const parseResult = loginSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz e-posta veya şifre formatı.',
            requestId: request.id,
            details: parseResult.error.format(),
          },
        });
      }

      const { email, password } = parseResult.data;

      try {
        const { user, sessionToken } = await fastify.authService.login(
          email,
          password,
          request.ip,
          request.headers['user-agent'],
        );

        reply.setCookie('session_id', sessionToken, {
          path: '/',
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        });

        return reply.status(200).send({
          user,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
          return reply.status(401).send({
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'E-posta adresi veya şifre hatalı.',
              requestId: request.id,
            },
          });
        }

        throw err;
      }
    },
  );

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    if (request.sessionToken) {
      await fastify.authService.logout(request.sessionToken);
    }

    reply.clearCookie('session_id', {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return reply.status(200).send({ success: true });
  });

  // PUT /api/auth/profile: Update user display name
  fastify.put<{ Body: { name: string } }>(
    '/profile',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parseResult = updateProfileSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz profil bilgileri.',
            requestId: request.id,
            details: parseResult.error.format(),
          },
        });
      }

      const userId = request.user!.id;
      const updatedUser = await fastify.authService.updateProfile(userId, parseResult.data.name);

      return reply.status(200).send({
        user: updatedUser,
        message: 'Profil bilgileri başarıyla güncellendi.',
      });
    },
  );

  // PUT /api/auth/change-password: Change user password with Argon2id verification
  fastify.put(
    '/change-password',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parseResult = changePasswordSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz şifre formatı.',
            requestId: request.id,
            details: parseResult.error.format(),
          },
        });
      }

      const userId = request.user!.id;
      const { currentPassword, newPassword } = parseResult.data;

      try {
        const { user, sessionToken } = await fastify.authService.changePassword(
          userId,
          currentPassword,
          newPassword,
        );

        reply.setCookie('session_id', sessionToken, {
          path: '/',
          httpOnly: true,
          secure: env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60,
        });

        return reply.status(200).send({
          user,
          message: 'Şifreniz başarıyla değiştirildi.',
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'INVALID_CURRENT_PASSWORD') {
          return reply.status(400).send({
            error: {
              code: 'INVALID_CURRENT_PASSWORD',
              message: 'Mevcut şifreniz hatalı.',
              requestId: request.id,
            },
          });
        }
        throw err;
      }
    },
  );

  // GET /api/auth/session
  fastify.get<{ Reply: { authenticated: boolean; user: UserDto | null } }>(
    '/session',
    async (request, reply) => {
      if (!request.user) {
        return reply.status(200).send({
          authenticated: false,
          user: null,
        });
      }

      return reply.status(200).send({
        authenticated: true,
        user: request.user,
      });
    },
  );

  // --- GOOGLE OAUTH 2.0 ROUTES ---

  // GET /api/auth/google: Redirects to Google consent screen
  fastify.get('/google', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const authUrl = fastify.googleOAuthService.generateAuthUrl(userId);
    return reply.redirect(authUrl);
  });

  // GET /api/auth/google/callback: Handles Google OAuth redirect
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/google/callback',
    async (request, reply) => {
      const { code, state, error } = request.query;

      if (error || !code || !state) {
        return reply.redirect(`${env.APP_URL}/settings?error=oauth_rejected`);
      }

      try {
        await fastify.googleOAuthService.handleCallback(code, state);
        return reply.redirect(`${env.APP_URL}/settings?google_connected=true`);
      } catch (err: unknown) {
        fastify.log.error({ err, requestId: request.id }, 'Google OAuth callback error');
        return reply.redirect(`${env.APP_URL}/settings?error=oauth_failed`);
      }
    },
  );

  // DELETE /api/auth/google: Unlinks Google account
  fastify.delete('/google', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    await fastify.googleOAuthService.unlinkGoogleAccount(userId);
    return reply.status(200).send({ success: true });
  });

  // GET /api/auth/google/status: Check Google Connection Status
  fastify.get(
    '/google/status',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const connections = await fastify.googleOAuthService.getConnectionsInfo(userId);

      return reply.status(200).send({
        connected: connections.length > 0,
        connection: connections[0] || null,
        connections,
      });
    },
  );

  // GET /api/auth/google/connections: List all connected Google accounts
  fastify.get(
    '/google/connections',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const connections = await fastify.googleOAuthService.getConnectionsInfo(userId);
      return reply.status(200).send({ connections });
    },
  );

  // DELETE /api/auth/google/connections/:id: Unlink specific connection
  fastify.delete<{ Params: { id: string } }>(
    '/google/connections/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { id } = request.params;
      await fastify.googleOAuthService.unlinkGoogleAccount(userId, id);
      return reply.status(200).send({ success: true });
    },
  );

  // GET /api/auth/google/drives/:connectionId: List Shared Drives for a connection
  fastify.get<{ Params: { connectionId: string } }>(
    '/google/drives/:connectionId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { connectionId } = request.params;
      const accessToken = await fastify.googleOAuthService.getValidAccessToken(userId, connectionId);

      const drives = await fastify.driveService.listSharedDrives(accessToken);
      return reply.status(200).send({ drives });
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, type LoginInput, type UserDto } from '@cinedrive/shared';
import { env } from '../config/env.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/auth/login
  fastify.post<{ Body: LoginInput }>('/login', async (request, reply) => {
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
  });

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
};

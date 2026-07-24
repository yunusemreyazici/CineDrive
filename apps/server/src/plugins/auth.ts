import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { GoogleOAuthService } from '../services/google-oauth.service.js';
import { LibraryScanService } from '../services/library-scan.service.js';
import type { UserDto } from '@cinedrive/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserDto | null;
    sessionToken: string | null;
  }
  interface FastifyInstance {
    authService: AuthService;
    googleOAuthService: GoogleOAuthService;
    libraryScanService: LibraryScanService;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin: FastifyPluginAsync = fp(async (fastify: FastifyInstance) => {
  const authService = new AuthService(fastify.prisma);
  const googleOAuthService = new GoogleOAuthService(fastify.prisma);
  const libraryScanService = new LibraryScanService(fastify.prisma, googleOAuthService);

  fastify.decorate('authService', authService);
  fastify.decorate('googleOAuthService', googleOAuthService);
  fastify.decorate('libraryScanService', libraryScanService);

  // Ensure initial admin user exists at server startup
  await authService.ensureAdminUserExists();

  // Attach session decorator to each request
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('sessionToken', null);

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const sessionToken = request.cookies.session_id;
    if (sessionToken) {
      request.sessionToken = sessionToken;
      request.user = await authService.getSessionUser(sessionToken);
    }
  });

  // Authentication preHandler hook helper
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Oturum açmanız gerekmektedir.',
          requestId: request.id,
        },
      });
    }
  });
});

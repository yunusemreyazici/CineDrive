import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { GoogleOAuthService } from '../services/google-oauth.service.js';
import { LibraryScanService } from '../services/library-scan.service.js';
import { GoogleDriveService } from '../services/drive.service.js';
import { SubtitleService } from '../services/subtitle.service.js';
import { PlaybackService } from '../services/playback.service.js';
import { TranscodeService } from '../services/transcode.service.js';
import { LocalScanService } from '../services/local-scan.service.js';
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
    driveService: GoogleDriveService;
    subtitleService: SubtitleService;
    playbackService: PlaybackService;
    transcodeService: TranscodeService;
    localScanService: LocalScanService;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin: FastifyPluginAsync = fp(async (fastify: FastifyInstance) => {
  const authService = new AuthService(fastify.prisma);
  const googleOAuthService = new GoogleOAuthService(fastify.prisma);
  const libraryScanService = new LibraryScanService(fastify.prisma, googleOAuthService);
  const driveService = new GoogleDriveService();
  const subtitleService = new SubtitleService(fastify.prisma, googleOAuthService);
  const playbackService = new PlaybackService(fastify.prisma);
  const transcodeService = new TranscodeService();
  const localScanService = new LocalScanService(fastify.prisma);

  fastify.decorate('authService', authService);
  fastify.decorate('googleOAuthService', googleOAuthService);
  fastify.decorate('libraryScanService', libraryScanService);
  fastify.decorate('driveService', driveService);
  fastify.decorate('subtitleService', subtitleService);
  fastify.decorate('playbackService', playbackService);
  fastify.decorate('transcodeService', transcodeService);
  fastify.decorate('localScanService', localScanService);

  // Ensure initial admin user exists at server startup
  await authService.ensureAdminUserExists();

  // Attach session decorator to each request
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('sessionToken', null);

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    let sessionToken = request.cookies.session_id;

    if (!sessionToken && request.headers.authorization) {
      const authHeader = request.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        sessionToken = authHeader.substring(7);
      }
    }

    if (!sessionToken && (request.query as Record<string, string>)?.token) {
      sessionToken = (request.query as Record<string, string>).token;
    }

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

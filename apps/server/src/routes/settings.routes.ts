import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const apiSettingsSchema = z.object({
  openSubtitlesApiKey: z.string().trim().max(500).optional(),
  openSubtitlesUsername: z.string().trim().max(200).optional(),
  preferredLanguages: z.string().trim().max(100).optional(),
  tmdbApiKey: z.string().trim().max(500).optional(),
  acoustidApiKey: z.string().trim().max(500).optional(),
  clearOpenSubtitlesApiKey: z.boolean().optional(),
  clearTmdbApiKey: z.boolean().optional(),
  clearAcoustidApiKey: z.boolean().optional(),
});

const apiKeySource = (userValue?: string | null, environmentValue?: string) =>
  userValue ? 'user' : environmentValue ? 'environment' : 'none';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  const serializeApiSettings = (user: {
    opensubtitlesApiKey: string | null;
    opensubtitlesUsername: string | null;
    preferredLanguages: string;
    tmdbApiKey: string | null;
    acoustidApiKey: string | null;
  }) => ({
    openSubtitles: {
      username: user.opensubtitlesUsername || '',
      preferredLanguages: user.preferredLanguages || 'tr,en',
      hasApiKey: !!(user.opensubtitlesApiKey || process.env.OPENSUBTITLES_API_KEY),
      source: apiKeySource(user.opensubtitlesApiKey, process.env.OPENSUBTITLES_API_KEY),
    },
    tmdb: {
      hasApiKey: !!(user.tmdbApiKey || process.env.TMDB_API_KEY),
      source: apiKeySource(user.tmdbApiKey, process.env.TMDB_API_KEY),
    },
    music: {
      acoustId: {
        hasApiKey: !!(user.acoustidApiKey || process.env.ACOUSTID_API_KEY),
        source: apiKeySource(user.acoustidApiKey, process.env.ACOUSTID_API_KEY),
      },
      onlineMetadataEnabled: process.env.MUSIC_METADATA_ONLINE !== 'false',
      libreTranslateConfigured: Boolean(process.env.LIBRETRANSLATE_URL),
    },
  });

  // API keys are write-only over HTTP. The UI can replace or explicitly clear
  // them, but a stored credential is never sent back to the browser.
  fastify.get('/api-keys', async (request, reply) => {
    const user = await fastify.prisma.user.findUniqueOrThrow({
      where: { id: request.user!.id },
      select: {
        opensubtitlesApiKey: true,
        opensubtitlesUsername: true,
        preferredLanguages: true,
        tmdbApiKey: true,
        acoustidApiKey: true,
      },
    });
    return reply.status(200).send(serializeApiSettings(user));
  });

  fastify.put('/api-keys', async (request, reply) => {
    const parsed = apiSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'API ayarları geçersiz.',
          requestId: request.id,
          details: parsed.error.format(),
        },
      });
    }

    const input = parsed.data;
    const openSubtitlesApiKey = input.openSubtitlesApiKey?.trim();
    const tmdbApiKey = input.tmdbApiKey?.trim();
    const acoustidApiKey = input.acoustidApiKey?.trim();
    const updated = await fastify.prisma.user.update({
      where: { id: request.user!.id },
      data: {
        ...(input.clearOpenSubtitlesApiKey
          ? { opensubtitlesApiKey: null }
          : openSubtitlesApiKey
            ? { opensubtitlesApiKey: openSubtitlesApiKey }
            : {}),
        ...(input.clearTmdbApiKey ? { tmdbApiKey: null } : tmdbApiKey ? { tmdbApiKey } : {}),
        ...(input.clearAcoustidApiKey
          ? { acoustidApiKey: null }
          : acoustidApiKey
            ? { acoustidApiKey }
            : {}),
        ...(input.openSubtitlesUsername !== undefined
          ? { opensubtitlesUsername: input.openSubtitlesUsername.trim() || null }
          : {}),
        ...(input.preferredLanguages !== undefined
          ? { preferredLanguages: input.preferredLanguages.trim() || 'tr,en' }
          : {}),
      },
      select: {
        opensubtitlesApiKey: true,
        opensubtitlesUsername: true,
        preferredLanguages: true,
        tmdbApiKey: true,
        acoustidApiKey: true,
      },
    });

    return reply.status(200).send(serializeApiSettings(updated));
  });

  // GET /api/settings/opensubtitles
  fastify.get('/opensubtitles', async (request, reply) => {
    const userId = request.user!.id;
    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: {
        opensubtitlesApiKey: true,
        opensubtitlesUsername: true,
        preferredLanguages: true,
      },
    });

    return reply.status(200).send({
      apiKey: '',
      username: user?.opensubtitlesUsername || '',
      preferredLanguages: user?.preferredLanguages || 'tr,en',
      hasApiKey: !!(user?.opensubtitlesApiKey || process.env.OPENSUBTITLES_API_KEY),
    });
  });

  // PUT /api/settings/opensubtitles
  // A password is deliberately not accepted: the OpenSubtitles client
  // authenticates with the API key, so storing one would keep a credential the
  // application never uses.
  fastify.put<{
    Body: {
      apiKey?: string;
      username?: string;
      preferredLanguages?: string;
    };
  }>('/opensubtitles', async (request, reply) => {
    const userId = request.user!.id;
    const { apiKey, username, preferredLanguages } = request.body;

    const updatedUser = await fastify.prisma.user.update({
      where: { id: userId },
      data: {
        opensubtitlesApiKey: apiKey !== undefined ? apiKey.trim() : undefined,
        opensubtitlesUsername: username !== undefined ? username.trim() : undefined,
        preferredLanguages:
          preferredLanguages !== undefined ? preferredLanguages.trim() : undefined,
      },
      select: {
        opensubtitlesApiKey: true,
        opensubtitlesUsername: true,
        preferredLanguages: true,
      },
    });

    return reply.status(200).send({
      message: 'OpenSubtitles ayarları başarıyla güncellendi.',
      apiKey: '',
      username: updatedUser.opensubtitlesUsername || '',
      preferredLanguages: updatedUser.preferredLanguages || 'tr,en',
      hasApiKey: !!(updatedUser.opensubtitlesApiKey || process.env.OPENSUBTITLES_API_KEY),
    });
  });
};

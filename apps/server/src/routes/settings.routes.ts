import type { FastifyPluginAsync } from 'fastify';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

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
      apiKey: user?.opensubtitlesApiKey || '',
      username: user?.opensubtitlesUsername || '',
      preferredLanguages: user?.preferredLanguages || 'tr,en',
      hasApiKey: !!(user?.opensubtitlesApiKey || process.env.OPENSUBTITLES_API_KEY),
    });
  });

  // PUT /api/settings/opensubtitles
  fastify.put<{
    Body: {
      apiKey?: string;
      username?: string;
      password?: string;
      preferredLanguages?: string;
    };
  }>('/opensubtitles', async (request, reply) => {
    const userId = request.user!.id;
    const { apiKey, username, password, preferredLanguages } = request.body;

    const updatedUser = await fastify.prisma.user.update({
      where: { id: userId },
      data: {
        opensubtitlesApiKey: apiKey !== undefined ? apiKey.trim() : undefined,
        opensubtitlesUsername: username !== undefined ? username.trim() : undefined,
        opensubtitlesPassword: password !== undefined ? password.trim() : undefined,
        preferredLanguages: preferredLanguages !== undefined ? preferredLanguages.trim() : undefined,
      },
      select: {
        opensubtitlesApiKey: true,
        opensubtitlesUsername: true,
        preferredLanguages: true,
      },
    });

    return reply.status(200).send({
      message: 'OpenSubtitles ayarları başarıyla güncellendi.',
      apiKey: updatedUser.opensubtitlesApiKey || '',
      username: updatedUser.opensubtitlesUsername || '',
      preferredLanguages: updatedUser.preferredLanguages || 'tr,en',
      hasApiKey: !!(updatedUser.opensubtitlesApiKey || process.env.OPENSUBTITLES_API_KEY),
    });
  });
};

import type { FastifyPluginAsync } from 'fastify';
import {
  updateMediaMetadataSchema,
  batchDeleteMediaSchema,
  type UpdateMediaMetadataInput,
} from '@cinedrive/shared';
import { manageableMediaFilter } from '../utils/library-access.js';

export const mediaEditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  const deleteMediaRows = async (userId: string, requestedIds: string[]) => {
    const ids = [...new Set(requestedIds)];
    const candidates = await fastify.prisma.mediaItem.findMany({
      where: { id: { in: ids }, ...manageableMediaFilter(userId) },
      select: { libraryId: true },
    });
    const locks: Array<{ release(): Promise<void> }> = [];
    try {
      for (const libraryId of [
        ...new Set(candidates.flatMap((item) => (item.libraryId ? [item.libraryId] : []))),
      ].sort()) {
        locks.push(await fastify.libraryOperationLockService.acquire(libraryId, 'delete'));
      }

      return await fastify.prisma.$transaction(async (tx) => {
        const mediaItems = await tx.mediaItem.findMany({
          where: { id: { in: ids }, ...manageableMediaFilter(userId) },
          select: {
            id: true,
            movie: { select: { driveFileId: true } },
            series: {
              select: {
                seasons: { select: { episodes: { select: { driveFileId: true } } } },
              },
            },
          },
        });
        const driveFileIds = [
          ...new Set(
            mediaItems.flatMap((item) => [
              ...(item.movie?.driveFileId ? [item.movie.driveFileId] : []),
              ...(item.series?.seasons.flatMap((season) =>
                season.episodes.map((episode) => episode.driveFileId),
              ) || []),
            ]),
          ),
        ];
        const ownedIds = mediaItems.map((item) => item.id);
        const deleteResult = await tx.mediaItem.deleteMany({
          where: { id: { in: ownedIds }, ...manageableMediaFilter(userId) },
        });

        // A DriveFile can be referenced by more than one derived media row in
        // legacy data. Only remove the physical index row after all references
        // are gone; the database cascade then cleans its subtitle/music data.
        if (driveFileIds.length) {
          await tx.driveFile.deleteMany({
            where: {
              id: { in: driveFileIds },
              movies: { none: {} },
              episodes: { none: {} },
              subtitles: { none: {} },
              musicTrack: { is: null },
            },
          });
        }
        return deleteResult.count;
      });
    } finally {
      await Promise.all(locks.map((lock) => lock.release()));
    }
  };

  // POST /api/media/batch-delete: Bulk remove media items from the database
  fastify.post<{ Body: { ids: string[] } }>('/batch-delete', async (request, reply) => {
    const parseResult = batchDeleteMediaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues[0]?.message || 'En az 1 içerik seçilmelidir.',
          requestId: request.id,
        },
      });
    }

    const { ids } = parseResult.data;

    /*
     * Every endpoint in this file addressed media by id alone. Being signed in
     * was the only requirement, so any account could delete or rewrite another
     * account's records by guessing or reading an id — and the ids are derived
     * from the title (`media_movie_inception`), so they are guessable.
     */
    let deletedCount: number;
    try {
      deletedCount = await deleteMediaRows(request.user!.id, ids);
    } catch (error) {
      if (error instanceof Error && error.message === 'LIBRARY_OPERATION_IN_PROGRESS') {
        return reply.status(409).send({
          error: {
            code: 'LIBRARY_OPERATION_IN_PROGRESS',
            message: 'Kütüphane taraması veya başka bir silme işlemi devam ediyor.',
            requestId: request.id,
          },
        });
      }
      throw error;
    }

    return reply.status(200).send({
      message: `${deletedCount} adet medya içeriği veritabanından silindi.`,
      deletedCount,
    });
  });

  // PATCH /api/media/:id: Update media item metadata
  fastify.patch<{ Params: { id: string }; Body: UpdateMediaMetadataInput }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;

      const parseResult = updateMediaMetadataSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parseResult.error.issues[0]?.message || 'Geçersiz veri.',
            requestId: request.id,
          },
        });
      }

      const data = parseResult.data;
      const updatePayload: Record<string, unknown> = {};

      if (data.title !== undefined) {
        updatePayload.title = data.title;
        updatePayload.normalizedTitle = data.title.toLowerCase();
      }
      if (data.year !== undefined) updatePayload.year = data.year;
      if (data.overview !== undefined) updatePayload.overview = data.overview;
      if (data.posterUrl !== undefined) updatePayload.posterUrl = data.posterUrl;
      if (data.backdropUrl !== undefined) updatePayload.backdropUrl = data.backdropUrl;
      if (data.voteAverage !== undefined) updatePayload.voteAverage = data.voteAverage;
      if (data.trailerUrl !== undefined) updatePayload.trailerUrl = data.trailerUrl;
      if (data.genres !== undefined) updatePayload.genres = JSON.stringify(data.genres);

      // Keep the authorization predicate in the write itself. A membership
      // revoke between a preliminary find and update must not leave a stale
      // caller able to mutate a now-inaccessible media row.
      const updated = await fastify.prisma.$transaction(async (tx) => {
        const result = await tx.mediaItem.updateMany({
          where: { id, ...manageableMediaFilter(request.user!.id) },
          data: updatePayload,
        });
        if (!result.count) return null;
        return tx.mediaItem.findUnique({ where: { id } });
      });

      if (!updated) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_NOT_FOUND',
            message: 'Medya içeriği bulunamadı.',
            requestId: request.id,
          },
        });
      }

      return reply.status(200).send({
        message: 'Medya bilgileri başarıyla güncellendi.',
        mediaItem: updated,
      });
    },
  );

  // DELETE /api/media/:id: Remove a media item from the database
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const mediaItem = await fastify.prisma.mediaItem.findFirst({
      where: { id, ...manageableMediaFilter(request.user!.id) },
      select: { id: true },
    });

    if (!mediaItem) {
      return reply.status(404).send({
        error: {
          code: 'MEDIA_NOT_FOUND',
          message: 'Silinecek medya içeriği bulunamadı.',
          requestId: request.id,
        },
      });
    }

    try {
      await deleteMediaRows(request.user!.id, [mediaItem.id]);
    } catch (error) {
      if (error instanceof Error && error.message === 'LIBRARY_OPERATION_IN_PROGRESS') {
        return reply.status(409).send({
          error: {
            code: 'LIBRARY_OPERATION_IN_PROGRESS',
            message: 'Kütüphane taraması veya başka bir silme işlemi devam ediyor.',
            requestId: request.id,
          },
        });
      }
      throw error;
    }

    return reply.status(200).send({
      message: 'Medya içeriği veritabanından başarıyla silindi.',
      deletedMediaId: id,
    });
  });
};

import type { FastifyPluginAsync } from 'fastify';
import {
  updateMediaMetadataSchema,
  batchDeleteMediaSchema,
  type UpdateMediaMetadataInput,
} from '@cinedrive/shared';

export const mediaEditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/media/batch-delete: Bulk remove media items from the database
  fastify.post<{ Body: { ids: string[] } }>('/batch-delete', async (request, reply) => {
    const parseResult = batchDeleteMediaSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.errors[0]?.message || 'En az 1 içerik seçilmelidir.',
          requestId: request.id,
        },
      });
    }

    const { ids } = parseResult.data;

    // Find all media items and associated driveFileIds
    const mediaItems = await fastify.prisma.mediaItem.findMany({
      where: { id: { in: ids } },
      include: {
        movie: true,
        series: {
          include: {
            seasons: {
              include: {
                episodes: true,
              },
            },
          },
        },
      },
    });

    const driveFileIdsToDelete: string[] = [];
    for (const item of mediaItems) {
      if (item.movie?.driveFileId) {
        driveFileIdsToDelete.push(item.movie.driveFileId);
      }
      if (item.series?.seasons) {
        for (const season of item.series.seasons) {
          for (const ep of season.episodes) {
            if (ep.driveFileId) driveFileIdsToDelete.push(ep.driveFileId);
          }
        }
      }
    }

    // Perform cascade delete of selected MediaItems
    const deleteResult = await fastify.prisma.mediaItem.deleteMany({
      where: { id: { in: ids } },
    });

    if (driveFileIdsToDelete.length > 0) {
      await fastify.prisma.driveFile.deleteMany({
        where: { id: { in: driveFileIdsToDelete } },
      }).catch(() => {});
    }

    return reply.status(200).send({
      message: `${deleteResult.count} adet medya içeriği veritabanından silindi.`,
      deletedCount: deleteResult.count,
    });
  });

  // PATCH /api/media/:id: Update media item metadata
  fastify.patch<{ Params: { id: string }; Body: UpdateMediaMetadataInput }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;

      const mediaItem = await fastify.prisma.mediaItem.findUnique({
        where: { id },
      });

      if (!mediaItem) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_NOT_FOUND',
            message: 'Medya içeriği bulunamadı.',
            requestId: request.id,
          },
        });
      }

      const parseResult = updateMediaMetadataSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parseResult.error.errors[0]?.message || 'Geçersiz veri.',
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

      const updated = await fastify.prisma.mediaItem.update({
        where: { id },
        data: updatePayload,
      });

      return reply.status(200).send({
        message: 'Medya bilgileri başarıyla güncellendi.',
        mediaItem: updated,
      });
    },
  );

  // DELETE /api/media/:id: Remove a media item from the database
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const mediaItem = await fastify.prisma.mediaItem.findUnique({
      where: { id },
      include: {
        movie: true,
        series: {
          include: {
            seasons: {
              include: {
                episodes: true,
              },
            },
          },
        },
      },
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

    // Collect drive file IDs associated with this media item or its episodes
    const driveFileIdsToDelete: string[] = [];
    if (mediaItem.movie?.driveFileId) {
      driveFileIdsToDelete.push(mediaItem.movie.driveFileId);
    }
    if (mediaItem.series?.seasons) {
      for (const season of mediaItem.series.seasons) {
        for (const ep of season.episodes) {
          if (ep.driveFileId) driveFileIdsToDelete.push(ep.driveFileId);
        }
      }
    }

    // Delete MediaItem (Prisma cascade handles Movie, Series, Episode, SubtitleTrack, PlaybackProgress, WatchHistory, Favorite)
    await fastify.prisma.mediaItem.delete({
      where: { id },
    });

    // Clean up associated DriveFile records if any
    if (driveFileIdsToDelete.length > 0) {
      await fastify.prisma.driveFile.deleteMany({
        where: { id: { in: driveFileIdsToDelete } },
      }).catch(() => {});
    }

    return reply.status(200).send({
      message: 'Medya içeriği veritabanından başarıyla silindi.',
      deletedMediaId: id,
    });
  });
};

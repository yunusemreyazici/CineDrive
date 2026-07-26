import type { FastifyPluginAsync } from 'fastify';
import { createLibrarySchema, updateLibrarySchema, type CreateLibraryInput, type UpdateLibraryInput } from '@cinedrive/shared';
import { env } from '../config/env.js';

export const libraryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * Every route addressing a single library goes through this. A library owned
   * by someone else answers exactly like one that does not exist, so the
   * endpoint never confirms that an id is real to a caller who cannot use it.
   */
  const findOwnedLibrary = (id: string, userId: string) =>
    fastify.prisma.library.findFirst({ where: { id, userId } });

  // GET /api/libraries: List the caller's libraries
  fastify.get('/', async (request, reply) => {
    const userId = request.user!.id;

    let libraries = await fastify.prisma.library.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    // Keep one configurable Google Drive library available. The environment
    // value is only an initial default and never overwrites UI changes.
    if (!libraries.some((library) => library.storageType === 'gdrive')) {
      const defaultLib = await fastify.prisma.library.create({
        data: {
          userId,
          name: 'Google Drive',
          storageType: 'gdrive',
          rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
        },
      });
      libraries = [...libraries, defaultLib];
    }

    return reply.status(200).send({ libraries });
  });

  // POST /api/libraries: Create a new library
  fastify.post<{ Body: CreateLibraryInput }>('/', async (request, reply) => {
    const parseResult = createLibrarySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz kütüphane adı veya klasör ID formatı.',
          requestId: request.id,
          details: parseResult.error.format(),
        },
      });
    }

    const { name, storageType, rootFolderId, localFolderPath, googleConnectionId } = parseResult.data;

    try {
      const library = await fastify.prisma.library.create({
        data: {
          userId: request.user!.id,
          name,
          storageType: storageType || 'gdrive',
          rootFolderId: rootFolderId || '',
          localFolderPath: localFolderPath || null,
          googleConnectionId: googleConnectionId || null,
        },
      });

      return reply.status(201).send({ library });
    } catch (err: unknown) {
      fastify.log.error({ err, requestId: request.id }, 'Library create failed');
      return reply.status(500).send({
        error: {
          code: 'LIBRARY_CREATE_FAILED',
          message: err instanceof Error ? err.message : 'Kütüphane oluşturulurken bir hata oluştu.',
          requestId: request.id,
        },
      });
    }
  });

  // PATCH /api/libraries/:id: Update library
  fastify.patch<{ Params: { id: string }; Body: UpdateLibraryInput }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = updateLibrarySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz kütüphane güncelleme verisi.',
            requestId: request.id,
            details: parseResult.error.format(),
          },
        });
      }

      const existing = await findOwnedLibrary(id, request.user!.id);
      if (!existing) {
        return reply.status(404).send({
          error: {
            code: 'LIBRARY_NOT_FOUND',
            message: 'Kütüphane bulunamadı.',
            requestId: request.id,
          },
        });
      }

      const updated = await fastify.prisma.library.update({
        where: { id },
        data: parseResult.data,
      });

      return reply.status(200).send({ library: updated });
    },
  );

  // POST /api/libraries/:id/scan: Trigger library scan
  fastify.post<{ Params: { id: string } }>('/:id/scan', async (request, reply) => {
    const { id } = request.params;
    const userId = request.user!.id;

    const library = await findOwnedLibrary(id, userId);
    if (!library) {
      return reply.status(404).send({
        error: {
          code: 'LIBRARY_NOT_FOUND',
          message: 'Kütüphane bulunamadı.',
          requestId: request.id,
        },
      });
    }

    // Both storage types answer as soon as the scan is registered. The client
    // follows progress through GET /:id/scans, which it already polls.
    if (library.storageType === 'local') {
      try {
        const scanId = await fastify.localScanService.startLocalScan(id);
        const scan = await fastify.prisma.libraryScan.findUnique({
          where: { id: scanId },
          include: { errors: true },
        });

        return reply.status(202).send({
          message: 'Yerel kütüphane taraması başlatıldı.',
          scan,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'SCAN_ALREADY_IN_PROGRESS') {
          return reply.status(409).send({
            error: {
              code: 'SCAN_ALREADY_IN_PROGRESS',
              message: 'Bu kütüphane için eşzamanlı bir tarama zaten devam ediyor.',
              requestId: request.id,
            },
          });
        }

        return reply.status(500).send({
          error: {
            code: 'LOCAL_SCAN_FAILED',
            message: err instanceof Error ? err.message : 'Yerel kütüphane taraması başarısız oldu.',
            requestId: request.id,
          },
        });
      }
    }

    try {
      const scanId = await fastify.libraryScanService.scanLibrary(userId, id);
      const scanResult = await fastify.prisma.libraryScan.findUnique({
        where: { id: scanId },
        include: { errors: true },
      });

      return reply.status(202).send({
        message: 'Kütüphane taraması başlatıldı.',
        scan: scanResult,
      });
    } catch (err: unknown) {
      fastify.log.error({ err, requestId: request.id }, 'Library scan failed');
      const isNotConnected =
        err instanceof Error &&
        (err.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED' ||
          err.message === 'GOOGLE_REAUTHORIZATION_REQUIRED' ||
          err.message.includes('File not found'));
      const isAlreadyRunning = err instanceof Error && err.message === 'SCAN_ALREADY_IN_PROGRESS';

      if (isAlreadyRunning) {
        return reply.status(409).send({
          error: {
            code: 'SCAN_ALREADY_IN_PROGRESS',
            message: 'Bu kütüphane için eşzamanlı bir tarama zaten devam ediyor.',
            requestId: request.id,
          },
        });
      }

      return reply.status(isNotConnected ? 400 : 500).send({
        error: {
          code: isNotConnected ? 'GOOGLE_ACCOUNT_NOT_CONNECTED' : 'SCAN_FAILED',
          message: isNotConnected
            ? 'Lütfen önce Google Drive hesabınızı bağlayın.'
            : (err instanceof Error ? err.message : 'Kütüphane taraması başarısız oldu.'),
          requestId: request.id,
        },
      });
    }
  });

  // GET /api/libraries/:id/scans: Get scan history
  fastify.get<{ Params: { id: string } }>('/:id/scans', async (request, reply) => {
    const { id } = request.params;

    const library = await findOwnedLibrary(id, request.user!.id);
    if (!library) {
      return reply.status(404).send({
        error: {
          code: 'LIBRARY_NOT_FOUND',
          message: 'Kütüphane bulunamadı.',
          requestId: request.id,
        },
      });
    }

    // Auto-cleanup any orphaned scans marked as 'running' in DB if not actively scanning in memory
    if (!fastify.libraryScanService.isScanning(id)) {
      await fastify.prisma.libraryScan.updateMany({
        where: { libraryId: id, status: 'running' },
        data: { status: 'failed', completedAt: new Date() },
      });
    }

    const scans = await fastify.prisma.libraryScan.findMany({
      where: { libraryId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { errors: true },
    });

    return reply.status(200).send({ scans });
  });

  // DELETE /api/libraries/:id/clear: Wipe all scanned media & files from the database
  fastify.delete<{ Params: { id: string } }>('/:id/clear', async (request, reply) => {
    const { id } = request.params;

    const library = await findOwnedLibrary(id, request.user!.id);
    if (!library) {
      return reply.status(404).send({
        error: {
          code: 'LIBRARY_NOT_FOUND',
          message: 'Kütüphane bulunamadı.',
          requestId: request.id,
        },
      });
    }

    /*
     * Scoped to this library. Every statement here except the two `libraryId`
     * ones used to be an unfiltered `deleteMany({})`: clearing one library
     * wiped every media item, subtitle, favourite and watch-history row in the
     * database — including other libraries' and, now that libraries have
     * owners, other accounts'.
     */
    const mediaIdsInLibrary = await fastify.prisma.mediaItem.findMany({
      where: {
        OR: [
          { movie: { driveFile: { libraryId: id } } },
          { episodes: { some: { driveFile: { libraryId: id } } } },
        ],
      },
      select: { id: true },
    });
    const mediaIds = mediaIdsInLibrary.map((item) => item.id);

    await fastify.prisma.libraryScan.deleteMany({ where: { libraryId: id } });

    if (mediaIds.length > 0) {
      // Progress, history and favourites are per-user rows about these media
      // items; the cascade from MediaItem removes them, but doing it first
      // keeps the intent explicit.
      await fastify.prisma.playbackProgress.deleteMany({
        where: { mediaItemId: { in: mediaIds } },
      });
      await fastify.prisma.watchHistory.deleteMany({
        where: { mediaItemId: { in: mediaIds } },
      });
      await fastify.prisma.favorite.deleteMany({ where: { mediaItemId: { in: mediaIds } } });
      await fastify.prisma.mediaItem.deleteMany({ where: { id: { in: mediaIds } } });
    }

    // Subtitles, episodes, seasons and series follow their DriveFile or their
    // MediaItem through the schema's cascades.
    const { count: removedFiles } = await fastify.prisma.driveFile.deleteMany({
      where: { libraryId: id },
    });

    await fastify.prisma.library.update({
      where: { id },
      data: { lastScannedAt: null },
    });

    return reply.status(200).send({
      message: 'Kütüphane veritabanı başarıyla temizlendi.',
      removed: { media: mediaIds.length, files: removedFiles },
    });
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { createLibrarySchema, updateLibrarySchema, type CreateLibraryInput, type UpdateLibraryInput } from '@cinedrive/shared';
import { env } from '../config/env.js';

export const libraryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/libraries: List all libraries
  fastify.get('/', async (_request, reply) => {
    let libraries = await fastify.prisma.library.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Keep one configurable Google Drive library available. The environment
    // value is only an initial default and never overwrites UI changes.
    if (!libraries.some((library) => library.storageType === 'gdrive')) {
      const defaultLib = await fastify.prisma.library.create({
        data: {
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

      const existing = await fastify.prisma.library.findUnique({ where: { id } });
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

    const library = await fastify.prisma.library.findUnique({ where: { id } });
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

    const library = await fastify.prisma.library.findUnique({ where: { id } });
    if (!library) {
      return reply.status(404).send({
        error: {
          code: 'LIBRARY_NOT_FOUND',
          message: 'Kütüphane bulunamadı.',
          requestId: request.id,
        },
      });
    }

    // Delete in sequence to clear all library media data
    await fastify.prisma.libraryScanError.deleteMany({});
    await fastify.prisma.libraryScan.deleteMany({ where: { libraryId: id } });
    await fastify.prisma.subtitleTrack.deleteMany({});
    await fastify.prisma.playbackProgress.deleteMany({});
    await fastify.prisma.watchHistory.deleteMany({});
    await fastify.prisma.favorite.deleteMany({});
    await fastify.prisma.episode.deleteMany({});
    await fastify.prisma.season.deleteMany({});
    await fastify.prisma.series.deleteMany({});
    await fastify.prisma.movie.deleteMany({});
    await fastify.prisma.mediaItem.deleteMany({});
    await fastify.prisma.driveFile.deleteMany({ where: { libraryId: id } });

    await fastify.prisma.library.update({
      where: { id },
      data: { lastScannedAt: null },
    });

    return reply.status(200).send({
      message: 'Kütüphane veritabanı başarıyla temizlendi.',
    });
  });
};

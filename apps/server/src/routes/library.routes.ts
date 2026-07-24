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

    // Auto-create or update default library from GOOGLE_DRIVE_ROOT_FOLDER_ID
    if (env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      if (libraries.length === 0) {
        const defaultLib = await fastify.prisma.library.create({
          data: {
            name: 'Main Media Library',
            rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
          },
        });
        libraries = [defaultLib];
      } else {
        const firstLib = libraries[0];
        if (firstLib && firstLib.rootFolderId !== env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
          const updated = await fastify.prisma.library.update({
            where: { id: firstLib.id },
            data: { rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID },
          });
          libraries[0] = updated;
        }
      }
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

    const { name, rootFolderId } = parseResult.data;

    const library = await fastify.prisma.library.create({
      data: { name, rootFolderId },
    });

    return reply.status(201).send({ library });
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

    try {
      const scanId = await fastify.libraryScanService.scanLibrary(userId, id);
      const scanResult = await fastify.prisma.libraryScan.findUnique({
        where: { id: scanId },
        include: { errors: true },
      });

      return reply.status(200).send({
        message: 'Kütüphane taraması tamamlandı.',
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

    const scans = await fastify.prisma.libraryScan.findMany({
      where: { libraryId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { errors: true },
    });

    return reply.status(200).send({ scans });
  });
};

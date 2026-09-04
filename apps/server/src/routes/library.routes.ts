import type { FastifyPluginAsync } from 'fastify';
import {
  createDriveScanSourceSchema,
  createLibrarySchema,
  validateLocalFolderSchema,
  updateLibrarySchema,
  upsertLibraryMemberSchema,
  type CreateDriveScanSourceInput,
  type CreateLibraryInput,
  type UpdateLibraryInput,
} from '@cinedrive/shared';
import { env } from '../config/env.js';
import type { DriveFolderInspection } from '../services/drive.service.js';
import { accessibleLibraryFilter, manageableLibraryFilter } from '../utils/library-access.js';
import { validateLocalFolder } from '../services/local-folder-validation.js';

export const libraryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  const driveService = fastify.driveService;

  /**
   * Every route addressing a single library goes through this. A library owned
   * by someone else answers exactly like one that does not exist, so the
   * endpoint never confirms that an id is real to a caller who cannot use it.
   */
  const findOwnedLibrary = (id: string, userId: string) =>
    fastify.prisma.library.findFirst({ where: { id, ...manageableLibraryFilter(userId) } });
  const findOwnerLibrary = (id: string, userId: string) =>
    fastify.prisma.library.findFirst({ where: { id, userId } });

  const serializeScanSummary = (scan: {
    status: string;
    startedAt: Date;
    heartbeatAt?: Date | null;
    completedAt: Date | null;
    interruptionReason?: string | null;
    durationMs: number | null;
    addedCount: number;
    updatedCount: number;
    deletedCount: number;
    errorCount: number;
    errors?: Array<{ errorMessage: string }>;
  }) => ({
    status: scan.status,
    startedAt: scan.startedAt.toISOString(),
    heartbeatAt: scan.heartbeatAt?.toISOString() || null,
    completedAt: scan.completedAt?.toISOString() || null,
    interruptionReason: scan.interruptionReason || null,
    durationMs: scan.durationMs,
    addedCount: scan.addedCount,
    updatedCount: scan.updatedCount,
    deletedCount: scan.deletedCount,
    errorCount: scan.errorCount,
    lastError: scan.errors?.[0]?.errorMessage || null,
  });

  const inspectDriveSource = async (
    userId: string,
    libraryId: string,
    googleConnectionId: string,
    rootFolderId: string,
  ): Promise<DriveFolderInspection> => {
    const connection = await fastify.prisma.googleConnection.findFirst({
      where: { id: googleConnectionId, userId },
    });
    if (!connection) throw new Error('GOOGLE_CONNECTION_NOT_FOUND');

    const accessToken = await fastify.googleOAuthService.getValidAccessToken(userId, connection.id);
    const normalizedFolderId = rootFolderId.trim();
    const inspection = normalizedFolderId
      ? await driveService.inspectFolder(accessToken, normalizedFolderId)
      : {
          id: '',
          name: 'Tüm Google Drive',
          path: 'Tüm Google Drive',
          webViewLink: 'https://drive.google.com/drive/my-drive',
          ancestorIds: [],
          hasMediaFiles: await driveService.accountContainsMedia(accessToken),
        };

    const existingSources = await fastify.prisma.driveScanSource.findMany({
      where: { libraryId },
      select: { id: true, googleConnectionId: true, rootFolderId: true },
    });
    if (existingSources.some((source) => source.rootFolderId === normalizedFolderId)) {
      throw new Error('DRIVE_SOURCE_DUPLICATE');
    }

    const sameConnectionSources = existingSources.filter(
      (source) => source.googleConnectionId === googleConnectionId,
    );
    if (
      sameConnectionSources.some(
        (source) =>
          !source.rootFolderId ||
          !normalizedFolderId ||
          inspection.ancestorIds.includes(source.rootFolderId),
      )
    ) {
      throw new Error('DRIVE_SOURCE_OVERLAP');
    }

    for (const source of sameConnectionSources) {
      if (!source.rootFolderId) continue;
      const existingInspection = await driveService.inspectFolder(
        accessToken,
        source.rootFolderId,
        false,
      );
      if (existingInspection.ancestorIds.includes(normalizedFolderId)) {
        throw new Error('DRIVE_SOURCE_OVERLAP');
      }
    }

    if (!inspection.hasMediaFiles) throw new Error('DRIVE_SOURCE_NO_MEDIA');
    return inspection;
  };

  // GET /api/libraries: List the caller's libraries
  fastify.get('/', async (request, reply) => {
    const userId = request.user!.id;

    let libraries = await fastify.prisma.library.findMany({
      where: accessibleLibraryFilter(userId),
      orderBy: { createdAt: 'asc' },
      include: {
        memberships: { where: { userId }, select: { role: true } },
        _count: { select: { files: true } },
        scans: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { errors: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
    });

    // Keep one configurable Google Drive library available. The environment
    // value is only an initial default and never overwrites UI changes.
    if (request.user!.role === 'admin' && !libraries.some((library) => library.userId === userId && library.storageType === 'gdrive')) {
      await fastify.prisma.library.create({
        data: {
          userId,
          name: 'Google Drive',
          storageType: 'gdrive',
          rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
          memberships: { create: { userId, role: 'owner' } },
        },
      });
      libraries = await fastify.prisma.library.findMany({
        where: accessibleLibraryFilter(userId),
        orderBy: { createdAt: 'asc' },
        include: {
          memberships: { where: { userId }, select: { role: true } },
          _count: { select: { files: true } },
          scans: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            include: { errors: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
        },
      });
    }

    return reply.status(200).send({
      libraries: libraries.map(({ _count, scans, memberships, ...library }) => ({
        ...library,
        accessRole: library.userId === userId ? 'owner' : memberships[0]?.role || 'listener',
        fileCount: _count.files,
        lastScan: scans[0] ? serializeScanSummary(scans[0]) : null,
      })),
    });
  });

  // Admin-only: do not expose filesystem existence to ordinary library members.
  fastify.post('/validate-local', async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Yönetici erişimi gereklidir.', requestId: request.id },
      });
    }
    const parsed = validateLocalFolderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Geçerli bir klasör yolu girin.', requestId: request.id },
      });
    }
    try {
      return { validation: await validateLocalFolder(parsed.data.localFolderPath) };
    } catch (err) {
      request.log.warn({ err, requestId: request.id }, 'Local folder validation failed');
      return reply.code(400).send({
        error: {
          code: 'LOCAL_FOLDER_UNAVAILABLE',
          message: 'Klasör sunucuda bulunamadı veya okunamıyor.',
          requestId: request.id,
        },
      });
    }
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

    const { name, storageType, rootFolderId, localFolderPath, googleConnectionId } =
      parseResult.data;

    try {
      const library = await fastify.prisma.library.create({
        data: {
          userId: request.user!.id,
          name,
          storageType: storageType || 'gdrive',
          rootFolderId: rootFolderId || '',
          localFolderPath: localFolderPath || null,
          googleConnectionId: googleConnectionId || null,
          memberships: { create: { userId: request.user!.id, role: 'owner' } },
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

  fastify.get<{ Params: { id: string } }>('/:id/members', async (request, reply) => {
    const library = await findOwnedLibrary(request.params.id, request.user!.id);
    if (!library) return reply.status(404).send({ error: { code: 'LIBRARY_NOT_FOUND', message: 'Kütüphane bulunamadı.', requestId: request.id } });
    const memberships = await fastify.prisma.libraryMembership.findMany({
      where: { libraryId: library.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    const owner = await fastify.prisma.user.findUnique({ where: { id: library.userId } });
    return {
      members: [
        ...(owner ? [{ id: `owner:${owner.id}`, userId: owner.id, name: owner.name, email: owner.email, role: 'owner', createdAt: library.createdAt.toISOString() }] : []),
        ...memberships.filter((membership) => membership.userId !== library.userId).map((membership) => ({
          id: membership.id,
          userId: membership.userId,
          name: membership.user.name,
          email: membership.user.email,
          role: membership.role,
          createdAt: membership.createdAt.toISOString(),
        })),
      ],
    };
  });

  fastify.put<{ Params: { id: string } }>('/:id/members', async (request, reply) => {
    const library = await findOwnerLibrary(request.params.id, request.user!.id);
    if (!library) return reply.status(404).send({ error: { code: 'LIBRARY_NOT_FOUND', message: 'Kütüphane bulunamadı.', requestId: request.id } });
    const parsed = upsertLibraryMemberSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz üyelik bilgileri.', requestId: request.id, details: parsed.error.format() } });
    if (parsed.data.userId === library.userId) return reply.status(409).send({ error: { code: 'OWNER_MEMBERSHIP_IMMUTABLE', message: 'Kütüphane sahibi üyelik olarak değiştirilemez.', requestId: request.id } });
    const user = await fastify.prisma.user.findFirst({ where: { id: parsed.data.userId, disabledAt: null } });
    if (!user) return reply.status(404).send({ error: { code: 'USER_NOT_FOUND', message: 'Kullanıcı bulunamadı.', requestId: request.id } });
    const membership = await fastify.prisma.libraryMembership.upsert({
      where: { libraryId_userId: { libraryId: library.id, userId: user.id } },
      create: { libraryId: library.id, userId: user.id, role: parsed.data.role },
      update: { role: parsed.data.role },
    });
    return { membership };
  });

  fastify.delete<{ Params: { id: string; userId: string } }>('/:id/members/:userId', async (request, reply) => {
    const library = await findOwnerLibrary(request.params.id, request.user!.id);
    if (!library) return reply.status(404).send({ error: { code: 'LIBRARY_NOT_FOUND', message: 'Kütüphane bulunamadı.', requestId: request.id } });
    await fastify.prisma.libraryMembership.deleteMany({ where: { libraryId: library.id, userId: request.params.userId } });
    return reply.status(204).send();
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

  // Saved Google Drive folders are additive scan sources. Changing one no
  // longer invalidates or silently replaces the files indexed from another.
  fastify.get<{ Params: { id: string } }>('/:id/drive-sources', async (request, reply) => {
    const library = await findOwnedLibrary(request.params.id, request.user!.id);
    if (!library)
      return reply.status(404).send({
        error: {
          code: 'LIBRARY_NOT_FOUND',
          message: 'Kütüphane bulunamadı.',
          requestId: request.id,
        },
      });

    const sources = await fastify.prisma.driveScanSource.findMany({
      where: { libraryId: library.id },
      orderBy: { createdAt: 'asc' },
      include: {
        googleConnection: { select: { email: true } },
        _count: { select: { files: true } },
      },
    });

    // Sources created before folder metadata was introduced are repaired on
    // first read. A failed/expired account still leaves the original id usable.
    for (const source of sources) {
      if (source.folderName) continue;
      try {
        const metadata = source.rootFolderId
          ? await driveService.inspectFolder(
              await fastify.googleOAuthService.getValidAccessToken(
                request.user!.id,
                source.googleConnectionId,
              ),
              source.rootFolderId,
              false,
            )
          : {
              name: 'Tüm Google Drive',
              path: 'Tüm Google Drive',
              driveName: undefined,
              ownerName: undefined,
              webViewLink: 'https://drive.google.com/drive/my-drive',
            };
        const repaired = await fastify.prisma.driveScanSource.update({
          where: { id: source.id },
          data: {
            folderName: metadata.name,
            folderPath: metadata.path,
            driveName: metadata.driveName || null,
            ownerName: metadata.ownerName || null,
            webViewLink: metadata.webViewLink || null,
          },
        });
        Object.assign(source, repaired);
      } catch (error) {
        fastify.log.warn({ error, sourceId: source.id }, 'Drive source metadata repair failed');
      }
    }
    return reply.send({
      sources: sources.map((source) => ({
        id: source.id,
        libraryId: source.libraryId,
        googleConnectionId: source.googleConnectionId,
        googleAccountEmail: source.googleConnection.email,
        rootFolderId: source.rootFolderId,
        folderName: source.folderName,
        folderPath: source.folderPath,
        driveName: source.driveName,
        ownerName: source.ownerName,
        webViewLink: source.webViewLink,
        fileCount: source._count.files,
        lastScan: source.lastScanStatus
          ? {
              status: source.lastScanStatus,
              startedAt: new Date(
                (source.lastScannedAt || source.updatedAt).getTime() -
                  (source.lastScanDurationMs || 0),
              ).toISOString(),
              completedAt:
                source.lastScanStatus === 'running'
                  ? null
                  : source.lastScannedAt?.toISOString() || null,
              durationMs: source.lastScanDurationMs,
              addedCount: source.lastScanAddedCount,
              updatedCount: source.lastScanUpdatedCount,
              deletedCount: source.lastScanDeletedCount,
              errorCount: source.lastScanErrorCount,
              lastError: source.lastScanError,
              interruptionReason: source.lastScanInterruptionReason,
            }
          : null,
        createdAt: source.createdAt.toISOString(),
      })),
    });
  });

  fastify.post<{ Params: { id: string }; Body: CreateDriveScanSourceInput }>(
    '/:id/drive-sources/validate',
    async (request, reply) => {
      const library = await findOwnedLibrary(request.params.id, request.user!.id);
      if (!library) {
        return reply.status(404).send({
          error: {
            code: 'LIBRARY_NOT_FOUND',
            message: 'Kütüphane bulunamadı.',
            requestId: request.id,
          },
        });
      }
      const parsed = createDriveScanSourceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Google hesabı ve klasör ID’si geçersiz.',
            requestId: request.id,
          },
        });
      }

      try {
        const inspection = await inspectDriveSource(
          request.user!.id,
          library.id,
          parsed.data.googleConnectionId,
          parsed.data.rootFolderId,
        );
        return reply.send({
          validation: {
            folderName: inspection.name,
            folderPath: inspection.path,
            driveName: inspection.driveName || null,
            ownerName: inspection.ownerName || null,
            webViewLink: inspection.webViewLink || null,
            hasMediaFiles: inspection.hasMediaFiles,
          },
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'DRIVE_SOURCE_VALIDATION_FAILED';
        const messages: Record<string, string> = {
          GOOGLE_CONNECTION_NOT_FOUND: 'Google hesabı bağlantısı bulunamadı.',
          DRIVE_SOURCE_NOT_FOLDER: 'Girilen Drive kimliği bir klasöre ait değil.',
          DRIVE_SOURCE_DUPLICATE: 'Bu Drive klasörü zaten kaynak olarak kayıtlı.',
          DRIVE_SOURCE_OVERLAP: 'Bu klasör kayıtlı başka bir kaynağın içinde veya üstünde.',
          DRIVE_SOURCE_NO_MEDIA: 'Bu klasörde veya alt klasörlerinde desteklenen medya bulunamadı.',
        };
        return reply.status(code === 'GOOGLE_CONNECTION_NOT_FOUND' ? 404 : 400).send({
          error: {
            code,
            message: messages[code] || 'Drive klasörü doğrulanamadı veya hesaptan erişilemiyor.',
            requestId: request.id,
          },
        });
      }
    },
  );

  fastify.post<{ Params: { id: string }; Body: CreateDriveScanSourceInput }>(
    '/:id/drive-sources',
    async (request, reply) => {
      const library = await findOwnedLibrary(request.params.id, request.user!.id);
      if (!library)
        return reply.status(404).send({
          error: {
            code: 'LIBRARY_NOT_FOUND',
            message: 'Kütüphane bulunamadı.',
            requestId: request.id,
          },
        });
      const parsed = createDriveScanSourceSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Google hesabı ve klasör ID’si geçersiz.',
            requestId: request.id,
          },
        });

      const connection = await fastify.prisma.googleConnection.findFirst({
        where: { id: parsed.data.googleConnectionId, userId: request.user!.id },
      });
      if (!connection)
        return reply.status(404).send({
          error: {
            code: 'GOOGLE_CONNECTION_NOT_FOUND',
            message: 'Google hesabı bağlantısı bulunamadı.',
            requestId: request.id,
          },
        });

      let inspection: DriveFolderInspection;
      try {
        inspection = await inspectDriveSource(
          request.user!.id,
          library.id,
          connection.id,
          parsed.data.rootFolderId,
        );
      } catch (error) {
        const code = error instanceof Error ? error.message : 'DRIVE_SOURCE_VALIDATION_FAILED';
        const messages: Record<string, string> = {
          DRIVE_SOURCE_NOT_FOLDER: 'Girilen Drive kimliği bir klasöre ait değil.',
          DRIVE_SOURCE_DUPLICATE: 'Bu Drive klasörü zaten kaynak olarak kayıtlı.',
          DRIVE_SOURCE_OVERLAP: 'Bu klasör kayıtlı başka bir kaynağın içinde veya üstünde.',
          DRIVE_SOURCE_NO_MEDIA: 'Bu klasörde veya alt klasörlerinde desteklenen medya bulunamadı.',
        };
        return reply.status(400).send({
          error: {
            code,
            message: messages[code] || 'Drive klasörü doğrulanamadı veya hesaptan erişilemiyor.',
            requestId: request.id,
          },
        });
      }

      const source = await fastify.prisma.driveScanSource.create({
        data: {
          libraryId: library.id,
          googleConnectionId: connection.id,
          rootFolderId: parsed.data.rootFolderId.trim(),
          folderName: inspection.name,
          folderPath: inspection.path,
          driveName: inspection.driveName || null,
          ownerName: inspection.ownerName || null,
          webViewLink: inspection.webViewLink || null,
        },
      });
      await fastify.prisma.library.update({
        where: { id: library.id },
        data: { rootFolderId: source.rootFolderId, googleConnectionId: source.googleConnectionId },
      });
      return reply.status(201).send({
        source: {
          ...source,
          googleAccountEmail: connection.email,
          fileCount: 0,
          lastScan: null,
        },
      });
    },
  );

  // Rescan exactly one saved folder. A library-wide scan remains available at
  // POST /:id/scan for users who want to refresh every connected source.
  fastify.post<{ Params: { id: string; sourceId: string } }>(
    '/:id/drive-sources/:sourceId/scan',
    async (request, reply) => {
      const library = await findOwnedLibrary(request.params.id, request.user!.id);
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
        const scanId = await fastify.libraryScanService.scanSource(
          request.user!.id,
          library.id,
          request.params.sourceId,
        );
        const scan = await fastify.prisma.libraryScan.findUnique({
          where: { id: scanId },
          include: { errors: true },
        });
        return reply.status(202).send({
          message: 'Drive klasörü yeniden taranmaya başlandı.',
          scan,
        });
      } catch (err: unknown) {
        const code = err instanceof Error ? err.message : 'SCAN_FAILED';
        if (code === 'DRIVE_SOURCE_NOT_FOUND') {
          return reply.status(404).send({
            error: {
              code,
              message: 'Drive klasör bağlantısı bulunamadı.',
              requestId: request.id,
            },
          });
        }
        if (code === 'SCAN_ALREADY_IN_PROGRESS') {
          return reply.status(409).send({
            error: {
              code,
              message: 'Bu kütüphane için eşzamanlı bir tarama zaten devam ediyor.',
              requestId: request.id,
            },
          });
        }
        const isNotConnected =
          code === 'GOOGLE_ACCOUNT_NOT_CONNECTED' ||
          code === 'GOOGLE_REAUTHORIZATION_REQUIRED' ||
          code.includes('File not found');
        return reply.status(isNotConnected ? 400 : 500).send({
          error: {
            code: isNotConnected ? 'GOOGLE_ACCOUNT_NOT_CONNECTED' : 'SCAN_FAILED',
            message: isNotConnected
              ? 'Bu klasöre bağlı Google hesabını yeniden bağlayın.'
              : 'Drive klasörü yeniden taranamadı.',
            requestId: request.id,
          },
        });
      }
    },
  );

  fastify.delete<{ Params: { id: string; sourceId: string } }>(
    '/:id/drive-sources/:sourceId',
    async (request, reply) => {
      const library = await findOwnedLibrary(request.params.id, request.user!.id);
      if (!library)
        return reply.status(404).send({
          error: {
            code: 'LIBRARY_NOT_FOUND',
            message: 'Kütüphane bulunamadı.',
            requestId: request.id,
          },
        });
      if (fastify.libraryScanService.isScanning(library.id))
        return reply.status(409).send({
          error: {
            code: 'SCAN_ALREADY_IN_PROGRESS',
            message: 'Tarama sürerken kaynak kaldırılamaz.',
            requestId: request.id,
          },
        });
      const source = await fastify.prisma.driveScanSource.findFirst({
        where: { id: request.params.sourceId, libraryId: library.id },
      });
      if (!source)
        return reply.status(404).send({
          error: {
            code: 'DRIVE_SOURCE_NOT_FOUND',
            message: 'Drive klasör bağlantısı bulunamadı.',
            requestId: request.id,
          },
        });

      const movies = await fastify.prisma.mediaItem.findMany({
        where: {
          libraryId: library.id,
          movie: { driveFile: { driveScanSourceId: source.id } },
        },
        select: { id: true },
      });
      const movieIds = movies.map((item) => item.id);
      const removed = await fastify.prisma.$transaction(async (tx) => {
        if (movieIds.length) await tx.mediaItem.deleteMany({ where: { id: { in: movieIds } } });
        const files = await tx.driveFile.deleteMany({ where: { driveScanSourceId: source.id } });

        // Deleting a Drive file cascades only its episode. Keep a series that
        // still has episodes from another source, then prune empty containers.
        await tx.season.deleteMany({
          where: { series: { mediaItem: { libraryId: library.id } }, episodes: { none: {} } },
        });
        const emptySeries = await tx.series.findMany({
          where: { mediaItem: { libraryId: library.id }, seasons: { none: {} } },
          select: { mediaItemId: true },
        });
        if (emptySeries.length) {
          await tx.mediaItem.deleteMany({
            where: { id: { in: emptySeries.map((series) => series.mediaItemId) } },
          });
        }
        await tx.driveScanSource.delete({ where: { id: source.id } });
        const replacement = await tx.driveScanSource.findFirst({
          where: { libraryId: library.id },
          orderBy: { createdAt: 'asc' },
        });
        await tx.library.update({
          where: { id: library.id },
          data: {
            rootFolderId: replacement?.rootFolderId || '',
            googleConnectionId: replacement?.googleConnectionId || null,
          },
        });
        return files.count;
      });

      await fastify.prisma.musicAlbum.deleteMany({
        where: { userId: request.user!.id, tracks: { none: {} } },
      });
      await fastify.prisma.musicArtist.deleteMany({
        where: {
          userId: request.user!.id,
          trackCredits: { none: {} },
          albumTracks: { none: {} },
          albums: { none: {} },
        },
      });
      await fastify.prisma.musicArtwork.deleteMany({
        where: {
          userId: request.user!.id,
          albums: { none: {} },
          artists: { none: {} },
          tracks: { none: {} },
        },
      });
      return reply.send({ removed: { media: movieIds.length, files: removed } });
    },
  );

  // Removing a local library also removes its indexed CineDrive records. The
  // folder and files on disk are never modified.
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const library = await findOwnerLibrary(request.params.id, request.user!.id);
    if (!library) {
      return reply.status(404).send({
        error: {
          code: 'LIBRARY_NOT_FOUND',
          message: 'Kütüphane bulunamadı.',
          requestId: request.id,
        },
      });
    }
    if (library.storageType !== 'local') {
      return reply.status(400).send({
        error: {
          code: 'LIBRARY_DELETE_NOT_ALLOWED',
          message: 'Bu işlem yalnızca yerel kütüphaneler için kullanılabilir.',
          requestId: request.id,
        },
      });
    }
    if (fastify.libraryScanService.isScanning(library.id)) {
      return reply.status(409).send({
        error: {
          code: 'SCAN_ALREADY_IN_PROGRESS',
          message: 'Tarama sürerken yerel kütüphane kaldırılamaz.',
          requestId: request.id,
        },
      });
    }

    const [media, files] = await Promise.all([
      fastify.prisma.mediaItem.count({ where: { libraryId: library.id } }),
      fastify.prisma.driveFile.count({ where: { libraryId: library.id } }),
    ]);
    await fastify.prisma.library.delete({ where: { id: library.id } });
    await fastify.prisma.musicAlbum.deleteMany({
      where: { userId: request.user!.id, tracks: { none: {} } },
    });
    await fastify.prisma.musicArtist.deleteMany({
      where: {
        userId: request.user!.id,
        trackCredits: { none: {} },
        albumTracks: { none: {} },
        albums: { none: {} },
      },
    });
    await fastify.prisma.musicArtwork.deleteMany({
      where: {
        userId: request.user!.id,
        albums: { none: {} },
        artists: { none: {} },
        tracks: { none: {} },
      },
    });

    return reply.send({ removed: { library: 1, media, files } });
  });

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
            message:
              err instanceof Error ? err.message : 'Yerel kütüphane taraması başarısız oldu.',
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
            : err instanceof Error
              ? err.message
              : 'Kütüphane taraması başarısız oldu.',
          requestId: request.id,
        },
      });
    }
  });

  // GET /api/libraries/scans: Unified history for every source owned by the caller.
  fastify.get('/scans', async (request, reply) => {
    await fastify.scanLifecycleService.reconcileAbandonedScans({
      userId: request.user!.id,
      reason: 'server_restarted',
    });
    const scans = await fastify.prisma.libraryScan.findMany({
      where: { library: { userId: request.user!.id } },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        library: { select: { id: true, name: true, storageType: true, localFolderPath: true } },
        driveScanSource: {
          select: {
            id: true,
            folderName: true,
            folderPath: true,
            rootFolderId: true,
            googleConnection: { select: { email: true } },
          },
        },
        errors: { orderBy: { createdAt: 'desc' } },
      },
    });

    return reply.send({
      scans: scans.map((scan) => ({
        id: scan.id,
        libraryId: scan.libraryId,
        driveScanSourceId: scan.driveScanSourceId,
        sourceType:
          scan.library.storageType === 'local' ? 'local' : scan.driveScanSource ? 'drive' : 'all',
        sourceName:
          scan.library.storageType === 'local'
            ? scan.library.name
            : scan.driveScanSource?.folderName || 'Tüm Drive kaynakları',
        sourceLocation:
          scan.library.storageType === 'local'
            ? scan.library.localFolderPath
            : scan.driveScanSource
              ? `${scan.driveScanSource.googleConnection.email} · ${scan.driveScanSource.folderPath || scan.driveScanSource.rootFolderId}`
              : scan.library.name,
        ...serializeScanSummary(scan),
        errors: scan.errors.map((error) => ({
          id: error.id,
          driveFileId: error.driveFileId,
          errorMessage: error.errorMessage,
          createdAt: error.createdAt.toISOString(),
        })),
      })),
    });
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

    await fastify.scanLifecycleService.reconcileAbandonedScans({
      userId: request.user!.id,
      reason: 'server_restarted',
    });

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
    // A single indexed column now; this walked movie/episode -> driveFile ->
    // library to work out which media belonged here.
    const mediaIdsInLibrary = await fastify.prisma.mediaItem.findMany({
      where: { libraryId: id },
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

    await fastify.prisma.musicAlbum.deleteMany({
      where: { userId: request.user!.id, tracks: { none: {} } },
    });
    await fastify.prisma.musicArtist.deleteMany({
      where: {
        userId: request.user!.id,
        trackCredits: { none: {} },
        albumTracks: { none: {} },
        albums: { none: {} },
      },
    });
    await fastify.prisma.musicArtwork.deleteMany({
      where: {
        userId: request.user!.id,
        albums: { none: {} },
        artists: { none: {} },
        tracks: { none: {} },
      },
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

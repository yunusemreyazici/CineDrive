import type { FastifyPluginAsync } from 'fastify';
import { ownedLibraryFilter, ownedMediaFilter } from '../utils/library-access.js';

/**
 * Maintenance for the library database.
 *
 * The settings screen previously offered exactly one action here — "clear
 * everything" — with no way to see what was in the database or to remove the
 * rows that accumulate on their own.
 */
export const databaseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /** Media that no longer has anything playable behind it. */
  const orphanMediaFilter = {
    AND: [{ movie: { is: null } }, { episodes: { none: {} } }],
  };

  // GET /api/settings/database/stats
  fastify.get('/stats', async (request, reply) => {
    const userId = request.user!.id;
    const isAdmin = request.user!.role === 'admin';
    const libraryWhere = isAdmin ? undefined : ownedLibraryFilter(userId);
    const driveFileWhere = isAdmin ? undefined : { library: ownedLibraryFilter(userId) };
    const mediaWhere = isAdmin ? undefined : ownedMediaFilter(userId);
    const episodeWhere = isAdmin ? undefined : { mediaItem: ownedMediaFilter(userId) };
    const subtitleWhere = isAdmin
      ? undefined
      : { driveFile: { library: ownedLibraryFilter(userId) } };
    const orphanWhere = isAdmin
      ? orphanMediaFilter
      : { AND: [orphanMediaFilter, ownedMediaFilter(userId)] };

    const [
      libraries,
      driveFiles,
      movies,
      series,
      episodes,
      subtitles,
      watchHistory,
      favorites,
      scans,
      orphanMedia,
      pageStats,
    ] = await Promise.all([
      fastify.prisma.library.count({ where: libraryWhere }),
      fastify.prisma.driveFile.count({ where: driveFileWhere }),
      fastify.prisma.mediaItem.count({ where: { type: 'movie', ...(mediaWhere || {}) } }),
      fastify.prisma.mediaItem.count({ where: { type: 'series', ...(mediaWhere || {}) } }),
      fastify.prisma.episode.count({ where: episodeWhere }),
      fastify.prisma.subtitleTrack.count({ where: subtitleWhere }),
      fastify.prisma.watchHistory.count({ where: { userId } }),
      fastify.prisma.favorite.count({ where: { userId } }),
      fastify.prisma.libraryScan.count({
        where: libraryWhere ? { library: libraryWhere } : undefined,
      }),
      fastify.prisma.mediaItem.count({ where: orphanWhere }),
      // Asking SQLite for its own page accounting avoids guessing where the
      // database file ended up: a relative `file:` URL resolves against the
      // schema directory, not the working directory.
      fastify.prisma.$queryRawUnsafe<Array<{ page_count: number; page_size: number }>>(
        'SELECT (SELECT * FROM pragma_page_count()) AS page_count, (SELECT * FROM pragma_page_size()) AS page_size',
      ),
    ]);

    const page = pageStats[0];
    const sizeBytes = page ? Number(page.page_count) * Number(page.page_size) : 0;

    return reply.status(200).send({
      stats: {
        libraries,
        driveFiles,
        movies,
        series,
        episodes,
        subtitles,
        watchHistory,
        favorites,
        scans,
        orphanMedia,
        sizeBytes,
      },
    });
  });

  // POST /api/settings/database/cleanup
  fastify.post('/cleanup', async (request, reply) => {
    const userId = request.user!.id;
    const isAdmin = request.user!.role === 'admin';
    const libraries = await fastify.prisma.library.findMany({
      where: isAdmin ? undefined : { userId },
      select: { id: true },
    });
    const locks: Array<{ release(): Promise<void> }> = [];
    try {
      for (const library of libraries.sort((left, right) => left.id.localeCompare(right.id))) {
        locks.push(await fastify.libraryOperationLockService.acquire(library.id, 'database-clear'));
      }
    } catch (error) {
      await Promise.all(locks.map((lock) => lock.release()));
      if (error instanceof Error && error.message === 'LIBRARY_OPERATION_IN_PROGRESS') {
        return reply.status(409).send({
          error: {
            code: 'SCAN_ALREADY_IN_PROGRESS',
            message: 'Tarama veya başka bir kütüphane işlemi sürerken bakım yapılamaz.',
            requestId: request.id,
          },
        });
      }
      throw error;
    }

    try {
      // Media rows whose file was removed from Drive — or from a library that was
      // deleted — survive as records with nothing to play. A regular user may
      // only collect leftovers from libraries they own; otherwise a shared
      // listener/editor could delete another user's catalogue rows.
      const cleanupOrphanWhere = isAdmin
        ? orphanMediaFilter
        : { AND: [orphanMediaFilter, { library: { userId } }] };
      const { count: removedMedia } = await fastify.prisma.mediaItem.deleteMany({
        where: cleanupOrphanWhere,
      });

      const interruptedScans = await fastify.scanLifecycleService.reconcileAbandonedScans({
        ...(isAdmin ? {} : { userId }),
        reason: 'server_restarted',
      });

      // Track deletion is driven by DriveFile/Library cascades. The shared
      // artist, album and artwork rows become collectible once no owned track
      // references them anymore.
      const { count: removedMusicAlbums } = await fastify.prisma.musicAlbum.deleteMany({
        where: { userId, tracks: { none: {} } },
      });
      const { count: removedMusicArtists } = await fastify.prisma.musicArtist.deleteMany({
        where: {
          userId,
          albums: { none: {} },
          albumTracks: { none: {} },
          trackCredits: { none: {} },
        },
      });
      const { count: removedMusicArtwork } = await fastify.prisma.musicArtwork.deleteMany({
        where: { userId, albums: { none: {} }, artists: { none: {} }, tracks: { none: {} } },
      });

      return reply.status(200).send({
        removed: {
          media: removedMedia,
          staleScans: interruptedScans,
          musicAlbums: removedMusicAlbums,
          musicArtists: removedMusicArtists,
          musicArtwork: removedMusicArtwork,
        },
      });
    } finally {
      await Promise.all(locks.map((lock) => lock.release()));
    }
  });

  // DELETE /api/settings/database/clear: Remove every indexed record owned by
  // the caller while preserving accounts, source definitions and real files.
  fastify.delete('/clear', async (request, reply) => {
    const userId = request.user!.id;
    const libraries = await fastify.prisma.library.findMany({
      where: { userId },
      select: { id: true },
    });
    const libraryIds = libraries.map((library) => library.id);

    const locks: Array<{ release(): Promise<void> }> = [];
    try {
      for (const libraryId of [...libraryIds].sort()) {
        locks.push(await fastify.libraryOperationLockService.acquire(libraryId, 'database-clear'));
      }
    } catch (error) {
      await Promise.all(locks.map((lock) => lock.release()));
      if (error instanceof Error && error.message === 'LIBRARY_OPERATION_IN_PROGRESS') {
        return reply.status(409).send({
          error: {
            code: 'SCAN_ALREADY_IN_PROGRESS',
            message: 'Tarama veya başka bir kütüphane işlemi sürerken veritabanı temizlenemez.',
            requestId: request.id,
          },
        });
      }
      throw error;
    }

    try {
      const removed = await fastify.prisma.$transaction(async (tx) => {
        const media = await tx.mediaItem.count({ where: { libraryId: { in: libraryIds } } });
        const files = await tx.driveFile.count({ where: { libraryId: { in: libraryIds } } });

        await tx.libraryScan.deleteMany({ where: { libraryId: { in: libraryIds } } });
        await tx.mediaItem.deleteMany({ where: { libraryId: { in: libraryIds } } });
        await tx.driveFile.deleteMany({ where: { libraryId: { in: libraryIds } } });
        await tx.musicAlbum.deleteMany({ where: { userId, tracks: { none: {} } } });
        await tx.musicArtist.deleteMany({
          where: {
            userId,
            trackCredits: { none: {} },
            albumTracks: { none: {} },
            albums: { none: {} },
          },
        });
        await tx.musicArtwork.deleteMany({
          where: { userId, albums: { none: {} }, artists: { none: {} }, tracks: { none: {} } },
        });
        await tx.library.updateMany({
          where: { id: { in: libraryIds } },
          data: { lastScannedAt: null },
        });

        return { media, files };
      });

      return reply.send({ removed });
    } finally {
      await Promise.all(locks.map((lock) => lock.release()));
    }
  });
};

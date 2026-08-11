import type { FastifyPluginAsync } from 'fastify';
import { ownedLibraryFilter } from '../utils/library-access.js';

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
    const ownedFiles = { library: ownedLibraryFilter(userId) };

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
      fastify.prisma.library.count({ where: { userId } }),
      fastify.prisma.driveFile.count({ where: ownedFiles }),
      fastify.prisma.mediaItem.count({ where: { type: 'movie' } }),
      fastify.prisma.mediaItem.count({ where: { type: 'series' } }),
      fastify.prisma.episode.count(),
      fastify.prisma.subtitleTrack.count(),
      fastify.prisma.watchHistory.count({ where: { userId } }),
      fastify.prisma.favorite.count({ where: { userId } }),
      fastify.prisma.libraryScan.count({ where: { library: { userId } } }),
      fastify.prisma.mediaItem.count({ where: orphanMediaFilter }),
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
    // Media rows whose file was removed from Drive — or from a library that was
    // deleted — survive as records with nothing to play.
    const { count: removedMedia } = await fastify.prisma.mediaItem.deleteMany({
      where: orphanMediaFilter,
    });

    const interruptedScans = await fastify.scanLifecycleService.reconcileAbandonedScans({
      userId,
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
      where: { userId, albums: { none: {} }, tracks: { none: {} } },
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

    if (libraryIds.some((libraryId) => fastify.libraryScanService.isScanning(libraryId))) {
      return reply.status(409).send({
        error: {
          code: 'SCAN_ALREADY_IN_PROGRESS',
          message: 'Tarama sürerken veritabanı temizlenemez.',
          requestId: request.id,
        },
      });
    }

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
        where: { userId, albums: { none: {} }, tracks: { none: {} } },
      });
      await tx.library.updateMany({
        where: { id: { in: libraryIds } },
        data: { lastScannedAt: null },
      });

      return { media, files };
    });

    return reply.send({ removed });
  });
};

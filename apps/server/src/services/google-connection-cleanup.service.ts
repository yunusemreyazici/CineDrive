import type { Prisma, PrismaClient } from '@prisma/client';

export interface RemovedGoogleConnectionContent {
  sources: number;
  files: number;
  media: number;
}

/**
 * Removes only records that were indexed through one Google connection.
 * Physical Drive files are never changed; this service only touches CineDrive's
 * database and deliberately keeps content owned by other connected accounts.
 */
export class GoogleConnectionCleanupService {
  constructor(private readonly prisma: PrismaClient) {}

  public async getAffectedLibraryIds(userId: string, connectionIds: string[]) {
    if (connectionIds.length === 0) return [];

    const libraries = await this.prisma.library.findMany({
      where: {
        userId,
        OR: [
          { googleConnectionId: { in: connectionIds } },
          { driveScanSources: { some: { googleConnectionId: { in: connectionIds } } } },
          { files: { some: { googleConnectionId: { in: connectionIds } } } },
        ],
      },
      select: { id: true },
    });
    return libraries.map((library) => library.id);
  }

  public async removeConnectionContent(
    userId: string,
    connectionId: string,
  ): Promise<RemovedGoogleConnectionContent> {
    const [sources, currentLibraries] = await Promise.all([
      this.prisma.driveScanSource.findMany({
        where: { googleConnectionId: connectionId, googleConnection: { userId } },
        select: { id: true },
      }),
      this.prisma.library.findMany({
        where: { userId, googleConnectionId: connectionId },
        select: { id: true },
      }),
    ]);
    const sourceIds = sources.map((source) => source.id);
    const relatedFileClauses: Prisma.DriveFileWhereInput[] = [
      { googleConnectionId: connectionId },
      ...(sourceIds.length > 0 ? [{ driveScanSourceId: { in: sourceIds } }] : []),
    ];

    const movieRows = await this.prisma.mediaItem.findMany({
      where: {
        library: { userId },
        movie: { driveFile: { OR: relatedFileClauses } },
      },
      select: { id: true },
    });
    const movieIds = movieRows.map((movie) => movie.id);

    return this.prisma.$transaction(async (tx) => {
      const removedMovies = movieIds.length
        ? await tx.mediaItem.deleteMany({ where: { id: { in: movieIds } } })
        : { count: 0 };

      // Episodes, subtitle rows and music tracks cascade from their DriveFile.
      const removedFiles = await tx.driveFile.deleteMany({
        where: {
          library: { userId },
          OR: relatedFileClauses,
        },
      });

      // A series may contain episodes from several accounts. Remove only empty
      // seasons/series after the selected account's files have gone.
      await tx.season.deleteMany({
        where: { series: { mediaItem: { library: { userId } } }, episodes: { none: {} } },
      });
      const emptySeries = await tx.series.findMany({
        where: { mediaItem: { library: { userId } }, seasons: { none: {} } },
        select: { mediaItemId: true },
      });
      const removedSeries = emptySeries.length
        ? await tx.mediaItem.deleteMany({
            where: { id: { in: emptySeries.map((series) => series.mediaItemId) } },
          })
        : { count: 0 };

      const removedSources = await tx.driveScanSource.deleteMany({
        where: { googleConnectionId: connectionId, googleConnection: { userId } },
      });

      // If this account was the library's currently displayed scan scope, use
      // another saved source as the replacement instead of leaving stale IDs.
      for (const library of currentLibraries) {
        const replacement = await tx.driveScanSource.findFirst({
          where: { libraryId: library.id },
          orderBy: { createdAt: 'asc' },
        });
        await tx.library.update({
          where: { id: library.id },
          data: {
            googleConnectionId: replacement?.googleConnectionId || null,
            rootFolderId: replacement?.rootFolderId || '',
          },
        });
      }

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

      return {
        sources: removedSources.count,
        files: removedFiles.count,
        media: removedMovies.count + removedSeries.count,
      };
    });
  }
}

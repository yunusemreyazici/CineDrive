import type { PrismaClient } from '@cinedrive/prisma';

/** Owner-scoped maintenance counts, no hydration graph, file paths, lyrics or provider request. */
export async function studioHealth(db: PrismaClient, userId: string) {
  const where = { library: { userId }, driveFile: { status: 'active' } };
  const [
    total,
    unknownLanguage,
    missingYear,
    missingGenres,
    lyricsAvailable,
    lyricsIndexed,
    indexPending,
    scans,
  ] = await Promise.all([
    db.musicTrack.count({ where }),
    db.musicTrack.count({ where: { ...where, languageCode: null } }),
    db.musicTrack.count({
      where: { ...where, year: null, OR: [{ album: { is: null } }, { album: { year: null } }] },
    }),
    db.musicTrack.count({
      where: { ...where, genres: '[]', OR: [{ album: { is: null } }, { album: { genres: '[]' } }] },
    }),
    db.musicTrack.count({ where: { ...where, lyrics: { isNot: null } } }),
    db.musicTrack.count({ where: { ...where, lyrics: { searchText: { not: '' } } } }),
    // Empty normalized lyrics are processed but not searchable, not pending work.
    db.musicTrack.count({ where: { ...where, lyrics: { searchText: null } } }),
    db.libraryScan.findMany({
      where: { library: { userId } },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        addedCount: true,
        updatedCount: true,
        deletedCount: true,
        errorCount: true,
        startedAt: true,
        completedAt: true,
        heartbeatAt: true,
        library: { select: { name: true } },
      },
    }),
  ]);
  return {
    quality: {
      total,
      unknownLanguage,
      missingYear,
      missingGenres,
      lyricsAvailable,
      lyricsMissing: total - lyricsAvailable,
      lyricsIndexed,
      indexPending,
    },
    scans: scans.map(({ library, ...scan }) => ({
      ...scan,
      libraryName: library.name,
      estimatedRemainingSeconds: null,
    })),
  };
}

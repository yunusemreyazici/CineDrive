import type { PrismaClient } from '@cinedrive/prisma';
import { accessibleLibraryFilter } from '../utils/library-access.js';
import { parseGenres } from '../utils/music-format.js';

export const DISCOVERY_CANDIDATE_PAGE_SIZE = 400;

export interface DiscoveryCandidate {
  id: string;
  title: string;
  discNumber: number;
  trackNumber: number;
  artistId: string | null;
  artistName: string | null;
  artistArtworkUrl: string | null;
  albumId: string | null;
  albumTitle: string | null;
  albumYear: number | null;
  genres: string[];
  albumGenres: string[];
  year: number | null;
  duration: number | null;
  playCount: number;
  isFavorite: boolean;
  createdAt: Date;
}

/**
 * Walk the complete accessible catalogue without materializing the heavy track
 * response graph. The page size stays at the same safe boundary used by track
 * relation hydration, keeping Prisma's relation bind lists below SQLite's cap.
 */
export const loadDiscoveryCandidates = async (
  prisma: PrismaClient,
  userId: string,
): Promise<DiscoveryCandidate[]> => {
  const candidates: DiscoveryCandidate[] = [];
  let cursor: string | undefined;

  while (true) {
    const rows = await prisma.musicTrack.findMany({
      where: { library: accessibleLibraryFilter(userId) },
      orderBy: { id: 'asc' },
      take: DISCOVERY_CANDIDATE_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        discNumber: true,
        trackNumber: true,
        albumId: true,
        primaryArtistId: true,
        year: true,
        genres: true,
        duration: true,
        createdAt: true,
        album: { select: { title: true, year: true, genres: true } },
        primaryArtist: {
          select: { name: true, artwork: { select: { id: true } } },
        },
        favorites: { where: { userId }, select: { id: true }, take: 1 },
        _count: { select: { history: { where: { userId } } } },
      },
    });

    for (const row of rows) {
      candidates.push({
        id: row.id,
        title: row.title,
        discNumber: row.discNumber,
        trackNumber: row.trackNumber,
        artistId: row.primaryArtistId,
        artistName: row.primaryArtist?.name || null,
        artistArtworkUrl: row.primaryArtist?.artwork?.id
          ? `/api/music/artwork/${row.primaryArtist.artwork.id}`
          : null,
        albumId: row.albumId,
        albumTitle: row.album?.title || null,
        albumYear: row.album?.year || null,
        genres: parseGenres(row.genres),
        albumGenres: parseGenres(row.album?.genres),
        year: row.year,
        duration: row.duration,
        playCount: row._count.history,
        isFavorite: row.favorites.length > 0,
        createdAt: row.createdAt,
      });
    }

    if (rows.length < DISCOVERY_CANDIDATE_PAGE_SIZE) break;
    cursor = rows.at(-1)!.id;
  }

  return candidates;
};

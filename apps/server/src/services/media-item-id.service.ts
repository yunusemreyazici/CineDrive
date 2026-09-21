import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@cinedrive/prisma';

const baseMediaItemId = (type: string, normalizedTitle: string) => {
  const safeTitle = normalizedTitle
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `media_${type}_${safeTitle}`;
};

export interface MediaIdentityOptions {
  year?: number;
  driveFileId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /unique constraint|already exists/i.test(error.message);

const identitySelect = {
  type: true,
  libraryId: true,
  year: true,
  movie: { select: { driveFileId: true } },
  episodes: {
    select: {
      seasonNumber: true,
      episodeNumber: true,
      driveFileId: true,
    },
  },
} as const;

type MediaIdentityRow = {
  type: string;
  libraryId: string | null;
  year: number | null;
  movie: { driveFileId: string | null } | null;
  episodes: Array<{
    seasonNumber: number;
    episodeNumber: number;
    driveFileId: string;
  }>;
};

const matchesIdentity = (
  row: MediaIdentityRow,
  type: string,
  options: MediaIdentityOptions,
  libraryId: string,
): boolean => {
  if (row.type !== type) return false;
  if (row.libraryId !== libraryId) return false;
  if (!options.driveFileId) return true;

  if (type === 'movie') {
    return !row.movie?.driveFileId || row.movie.driveFileId === options.driveFileId;
  }

  if (
    type === 'series' &&
    options.seasonNumber !== undefined &&
    options.episodeNumber !== undefined
  ) {
    const episode = row.episodes.find(
      (candidate) =>
        candidate.seasonNumber === options.seasonNumber &&
        candidate.episodeNumber === options.episodeNumber,
    );
    return !episode || episode.driveFileId === options.driveFileId;
  }

  return true;
};

const collisionSuffix = (driveFileId: string) =>
  createHash('sha256').update(driveFileId).digest('hex').slice(0, 12);

/**
 * Keep the historical title-based identifier whenever it is unambiguous. If a
 * second library contains the same title, give that library a deterministic
 * suffix instead of re-homing the first library's row and its user progress.
 */
export const resolveMediaItemId = async (
  prisma: PrismaClient,
  type: string,
  normalizedTitle: string,
  libraryId: string,
  options: MediaIdentityOptions = {},
): Promise<string> => {
  const baseId = baseMediaItemId(type, normalizedTitle);
  const existing = await prisma.mediaItem.findUnique({
    where: { id: baseId },
    select: identitySelect,
  });

  if (!existing) return baseId;
  // An orphaned legacy row has no trustworthy owner. Reusing its id would
  // silently re-home its progress/favourites into the next library scanned.
  if (!existing.libraryId) return `${baseId}_${libraryId}`;
  if (existing.libraryId !== libraryId) {
    return `${baseId}_${libraryId}`;
  }

  const hasTypeCollision = existing.type !== type;
  const hasMovieCollision =
    type === 'movie' &&
    options.driveFileId !== undefined &&
    existing.movie?.driveFileId != null &&
    existing.movie.driveFileId !== options.driveFileId;
  const hasSeriesEpisodeCollision =
    type === 'series' &&
    options.driveFileId !== undefined &&
    options.seasonNumber !== undefined &&
    options.episodeNumber !== undefined &&
    existing.episodes.some(
      (episode) =>
        episode.seasonNumber === options.seasonNumber &&
        episode.episodeNumber === options.episodeNumber &&
        episode.driveFileId !== options.driveFileId,
    );
  const hasMovieYearCollision =
    type === 'movie' &&
    hasMovieCollision &&
    existing.year !== null &&
    options.year !== undefined &&
    existing.year !== options.year;

  if (
    !hasTypeCollision &&
    !hasMovieCollision &&
    !hasSeriesEpisodeCollision &&
    !hasMovieYearCollision
  ) {
    return baseId;
  }

  const readableSuffix = hasMovieYearCollision ? String(options.year) : null;
  const preferredId = `${baseId}_${readableSuffix || collisionSuffix(options.driveFileId || baseId)}`;
  const candidate = await prisma.mediaItem.findUnique({
    where: { id: preferredId },
    select: identitySelect,
  });
  if (!candidate || matchesIdentity(candidate, type, options, libraryId)) return preferredId;

  return `${preferredId}_${collisionSuffix(options.driveFileId || baseId)}`;
};

/**
 * Resolves again after a rare cross-library ID race. Library locks serialize
 * one catalogue, but two different libraries can discover the same title at
 * the same time; the first writer keeps the historical base ID and the other
 * writer must retry with its deterministic library/collision suffix.
 */
export const upsertMediaItemWithIdentity = async (
  prisma: PrismaClient,
  requestedId: string,
  type: string,
  normalizedTitle: string,
  libraryId: string,
  options: MediaIdentityOptions,
  createData: Omit<Prisma.MediaItemUncheckedCreateInput, 'id'>,
  updateData: Prisma.MediaItemUncheckedUpdateInput,
) => {
  const upsert = (id: string) =>
    prisma.mediaItem.upsert({
      where: { id },
      create: { id, ...createData },
      update: updateData,
    });

  try {
    return await upsert(requestedId);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const retryId = await resolveMediaItemId(prisma, type, normalizedTitle, libraryId, options);
    return upsert(retryId);
  }
};

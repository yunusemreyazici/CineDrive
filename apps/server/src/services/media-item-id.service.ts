import type { PrismaClient } from '@cinedrive/prisma';

const baseMediaItemId = (type: string, normalizedTitle: string) => {
  const safeTitle = normalizedTitle
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `media_${type}_${safeTitle}`;
};

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
): Promise<string> => {
  const baseId = baseMediaItemId(type, normalizedTitle);
  const existing = await prisma.mediaItem.findUnique({
    where: { id: baseId },
    select: { libraryId: true },
  });

  if (!existing || !existing.libraryId || existing.libraryId === libraryId) return baseId;
  return `${baseId}_${libraryId}`;
};


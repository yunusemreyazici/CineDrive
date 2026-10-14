import type { Prisma, PrismaClient } from '@cinedrive/prisma';

export const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /unique constraint|already exists/i.test(error.message);

/**
 * Existing rows use a library-scoped update: rescans should not issue one
 * failed INSERT per file. New rows still use create-first with a checked race
 * fallback, never an upsert branch that can rehome another library's file.
 */
export const createOrUpdateDriveFileForLibrary = async (
  prisma: PrismaClient,
  where: Prisma.DriveFileWhereUniqueInput,
  libraryId: string,
  create: Prisma.DriveFileUncheckedCreateInput,
  update: Prisma.DriveFileUncheckedUpdateInput,
) => {
  const updateExisting = async (existing: { id: string; libraryId: string }) => {
    if (existing.libraryId !== libraryId) throw new Error('DRIVE_FILE_LIBRARY_CONFLICT');
    return {
      // Repeat ownership in the atomic write: even a replacement between the
      // read and write cannot move a record into this library.
      record: await prisma.driveFile.update({
        where: { id: existing.id, libraryId },
        data: { ...update, libraryId },
      }),
      created: false,
    };
  };
  const existing = await prisma.driveFile.findUnique({ where });
  if (existing) return updateExisting(existing);
  try {
    return {
      record: await prisma.driveFile.create({ data: create }),
      created: true,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const existing = await prisma.driveFile.findUnique({ where });
    if (!existing) throw error;
    return updateExisting(existing);
  }
};

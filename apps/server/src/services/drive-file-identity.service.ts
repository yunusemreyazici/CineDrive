import type { Prisma, PrismaClient } from '@cinedrive/prisma';

export const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /unique constraint|already exists/i.test(error.message);

/**
 * Create first so a concurrent scan cannot use Prisma's upsert update branch
 * to move an existing DriveFile into another library. A unique-key race is
 * retried as an update only after the winner is re-read and ownership checked.
 */
export const createOrUpdateDriveFileForLibrary = async (
  prisma: PrismaClient,
  where: Prisma.DriveFileWhereUniqueInput,
  libraryId: string,
  create: Prisma.DriveFileUncheckedCreateInput,
  update: Prisma.DriveFileUncheckedUpdateInput,
) => {
  try {
    return {
      record: await prisma.driveFile.create({ data: create }),
      created: true,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const existing = await prisma.driveFile.findUnique({ where });
    if (!existing) throw error;
    if (existing.libraryId !== libraryId) throw new Error('DRIVE_FILE_LIBRARY_CONFLICT');

    return {
      record: await prisma.driveFile.update({ where: { id: existing.id }, data: update }),
      created: false,
    };
  }
};

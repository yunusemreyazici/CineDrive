import { describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { createOrUpdateDriveFileForLibrary } from '../src/services/drive-file-identity.service.js';
import { upsertMediaItemWithIdentity } from '../src/services/media-item-id.service.js';

const driveFileCreate = {
  libraryId: 'library-b',
  storageType: 'local',
  localFilePath: '/media/movie.mkv',
  name: 'movie.mkv',
  mimeType: 'video/x-matroska',
  status: 'active',
} satisfies Prisma.DriveFileUncheckedCreateInput;

const driveFileUpdate = {
  libraryId: 'library-b',
  name: 'movie.mkv',
  mimeType: 'video/x-matroska',
  status: 'active',
} satisfies Prisma.DriveFileUncheckedUpdateInput;

describe('cross-library identity races', () => {
  it('never converts a unique-key race into a DriveFile rehome', async () => {
    const prisma = {
      driveFile: {
        create: vi.fn().mockRejectedValue(new Error('Unique constraint failed on localFilePath')),
        findUnique: vi.fn().mockResolvedValue({ id: 'winner', libraryId: 'library-a' }),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;

    await expect(
      createOrUpdateDriveFileForLibrary(
        prisma,
        { localFilePath: '/media/movie.mkv' },
        'library-b',
        driveFileCreate,
        driveFileUpdate,
      ),
    ).rejects.toThrow('DRIVE_FILE_LIBRARY_CONFLICT');
    expect(prisma.driveFile.update).not.toHaveBeenCalled();
  });

  it('re-resolves a title ID after a concurrent base-ID insert', async () => {
    const prisma = {
      mediaItem: {
        upsert: vi
          .fn()
          .mockRejectedValueOnce(new Error('Unique constraint failed on id'))
          .mockResolvedValueOnce({ id: 'media_movie_title_library-b' }),
        findUnique: vi.fn().mockResolvedValue({
          type: 'movie',
          libraryId: 'library-a',
          year: null,
          movie: null,
          episodes: [],
        }),
      },
    } as unknown as PrismaClient;

    const result = await upsertMediaItemWithIdentity(
      prisma,
      'media_movie_title',
      'movie',
      'title',
      'library-b',
      {},
      { libraryId: 'library-b', type: 'movie', title: 'Title', normalizedTitle: 'title' },
      { libraryId: 'library-b', title: 'Title' },
    );

    expect(result.id).toBe('media_movie_title_library-b');
    expect(prisma.mediaItem.upsert).toHaveBeenCalledTimes(2);
  });
});

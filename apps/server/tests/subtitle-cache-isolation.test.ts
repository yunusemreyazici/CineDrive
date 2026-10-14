import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@cinedrive/prisma';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriveAccessService } from '../src/services/drive-access.service.js';
import { SubtitleService } from '../src/services/subtitle.service.js';

afterEach(() => vi.restoreAllMocks());

describe('subtitle cache identity isolation', () => {
  it('keeps two local libraries separate and ignores poisoned null-ID legacy cache entries', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-subtitle-isolation-'));
    const cache = path.join(directory, 'cache');
    const sourceA = path.join(directory, 'first.srt');
    const sourceB = path.join(directory, 'second.srt');
    const contents = ['First local fixture', 'Second local fixture'];
    await fs.mkdir(cache);
    await fs.writeFile(sourceA, `1\n00:00:01,000 --> 00:00:03,000\n${contents[0]}`);
    await fs.writeFile(sourceB, `1\n00:00:01,000 --> 00:00:03,000\n${contents[1]}`);
    const hash = (identity: string, version = 'v2') =>
      path.join(
        cache,
        `${createHash('sha256').update(`${identity}_1970_nochecksum_${version}`).digest('hex')}.vtt`,
      );
    for (const version of ['v1', 'v2'])
      await fs.writeFile(hash('null', version), 'Foreign cached content');
    const rows = [sourceA, sourceB].map((file, index) => ({
      id: `subtitle-${index}`,
      sourceFormat: 'srt',
      driveFile: {
        id: `file-${index}`,
        googleDriveFileId: null,
        modifiedTime: null,
        md5Checksum: null,
        size: 100n,
        status: 'active',
        storageType: 'local',
        name: `${index}.srt`,
        localFilePath: file,
        library: { id: `library-${index}`, userId: `owner-${index}`, localFolderPath: directory },
      },
    }));
    const findUnique = vi.fn();
    const find = vi.fn(
      async ({ where }: { where: { OR: Array<{ id?: string }> } }) =>
        rows.find((row) => row.id === where.OR.find((item) => item.id)?.id) ?? null,
    );
    const memberships = vi.fn().mockResolvedValue(0);
    const prisma = {
      subtitleTrack: { findFirst: find, findUnique },
      libraryMembership: { count: memberships },
    } as unknown as PrismaClient;
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No external provider'));
    const service = new SubtitleService(prisma, {} as DriveAccessService, cache);
    try {
      const first = await service.getSubtitleWebVTT('owner-0', 'subtitle-0');
      expect(first).toContain(contents[0]);
      expect(first).not.toContain('Foreign cached');
      await vi.waitFor(async () => {
        expect(await fs.readFile(hash('local:file-0'), 'utf8')).toContain(contents[0]);
      });
      const second = await service.getSubtitleWebVTT('owner-1', 'subtitle-1');
      expect(second).toContain(contents[1]);
      expect(second).not.toContain(contents[0]);
      await vi.waitFor(async () => {
        expect(await fs.readFile(hash('local:file-1'), 'utf8')).toContain(contents[1]);
      });
      // Once populated, each cache stays independent even if source disappears.
      await fs.unlink(sourceA);
      await fs.unlink(sourceB);
      expect(await service.getSubtitleWebVTT('owner-0', 'subtitle-0')).toBe(first);
      expect(await service.getSubtitleWebVTT('owner-1', 'subtitle-1')).toBe(second);
      const read = vi.spyOn(fs, 'readFile');
      await expect(service.getSubtitleWebVTT('owner-0', 'subtitle-1')).rejects.toThrow(
        'SUBTITLE_NOT_FOUND',
      );
      expect(read).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      read.mockRestore();
    } finally {
      // Remove only files belonging to this test's unique temporary directory.
      for (const file of [
        sourceA,
        sourceB,
        hash('null', 'v1'),
        hash('null'),
        hash('local:file-0'),
        hash('local:file-1'),
      ])
        await fs.unlink(file).catch(() => undefined);
      await fs.rmdir(cache);
      await fs.rmdir(directory);
    }
  });

  it('keeps remote/OpenSubtitles legacy cache keys and authorizes before cache reads', async () => {
    const prisma = {
      subtitleTrack: {
        findFirst: vi.fn().mockResolvedValue({
          sourceFormat: 'vtt',
          driveFile: {
            id: 'file',
            googleDriveFileId: 'opensub_123_owner',
            status: 'active',
            size: 20n,
            modifiedTime: null,
            md5Checksum: null,
            library: { id: 'lib', userId: 'owner' },
          },
        }),
      },
    } as unknown as PrismaClient;
    const directory = '/tmp/cinedrive-legacy-cache-fixture';
    const read = vi.spyOn(fs, 'readFile').mockResolvedValue('WEBVTT\n\nRemote fixture');
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const service = new SubtitleService(prisma, {} as DriveAccessService, directory);
    expect(await service.getSubtitleWebVTT('owner', 'file')).toContain('Remote fixture');
    const hash = createHash('sha256').update('opensub_123_owner_1970_nochecksum_v2').digest('hex');
    expect(read).toHaveBeenCalledWith(path.join(directory, `${hash}.vtt`), 'utf-8');
  });
});

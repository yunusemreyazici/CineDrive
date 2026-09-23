import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@cinedrive/prisma';
import { GoogleDriveService } from '../src/services/drive.service.js';
import { GoogleOAuthService } from '../src/services/google-oauth.service.js';
import { LibraryScanService } from '../src/services/library-scan.service.js';
import type { ScanLifecycleService } from '../src/services/scan-lifecycle.service.js';
import type { LibraryOperationLockService } from '../src/services/library-operation-lock.service.js';
import type { MetadataEnrichmentService } from '../src/services/metadata-enrichment.service.js';

describe('Google Drive folder tree scan', () => {
  it('visits each folder once and stops after the last queued folder', async () => {
    const oauth = {
      withValidAccessToken: vi.fn(
        async (
          _userId: string,
          _connectionId: string,
          operation: (token: string) => Promise<unknown>,
        ) => operation('test-token'),
      ),
    } as unknown as GoogleOAuthService;
    const lifecycle = {
      heartbeat: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScanLifecycleService;
    const service = new LibraryScanService(
      {} as PrismaClient,
      oauth,
      lifecycle,
      {} as LibraryOperationLockService,
      {} as MetadataEnrichmentService,
    );
    const list = vi
      .spyOn(GoogleDriveService.prototype, 'listFolderContents')
      .mockImplementation(async (_token, folderId, pageToken) => {
        if (folderId === 'root' && !pageToken) {
          return {
            files: [
              { id: 'child', name: 'Child', mimeType: 'application/vnd.google-apps.folder' },
              { id: 'root-video', name: 'Movie.mp4', mimeType: 'video/mp4' },
            ],
            nextPageToken: 'next',
          };
        }
        if (folderId === 'root' && pageToken === 'next') {
          return {
            files: [{ id: 'child', name: 'Child', mimeType: 'application/vnd.google-apps.folder' }],
          };
        }
        if (folderId === 'child' && !pageToken) {
          return { files: [{ id: 'child-video', name: 'Episode.mp4', mimeType: 'video/mp4' }] };
        }
        throw new Error(`Unexpected folder request: ${String(folderId)}`);
      });

    try {
      const files = await service['listFolderTree'](
        'user',
        'connection',
        'root',
        'scan',
        new AbortController().signal,
      );
      expect(files.map((file) => file.id)).toEqual(['root-video', 'child-video']);
      expect(list.mock.calls.map(([, folderId, pageToken]) => [folderId, pageToken])).toEqual([
        ['root', undefined],
        ['root', 'next'],
        ['child', undefined],
      ]);
    } finally {
      list.mockRestore();
    }
  });
});

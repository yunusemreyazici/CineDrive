import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DriveAccessService } from '../src/services/drive-access.service.js';
import type { GoogleDriveService } from '../src/services/drive.service.js';
import type { GoogleOAuthService } from '../src/services/google-oauth.service.js';

const legacyFile = () => ({
  id: 'drive-row-1',
  googleDriveFileId: 'google-file-1',
  googleConnectionId: null as string | null,
  library: { googleConnectionId: 'connection-new' },
});

describe('DriveAccessService', () => {
  it('uses the account stored on current DriveFile rows without probing Google', async () => {
    const getValidAccessToken = vi.fn().mockResolvedValue('stored-token');
    const canAccessFile = vi.fn();
    const update = vi.fn();
    const service = new DriveAccessService(
      { driveFile: { update } } as unknown as PrismaClient,
      { getValidAccessToken } as unknown as GoogleOAuthService,
      { canAccessFile } as unknown as GoogleDriveService,
    );
    const file = { ...legacyFile(), googleConnectionId: 'connection-old' };

    await expect(service.getAccess('user-1', file)).resolves.toEqual({
      accessToken: 'stored-token',
      connectionId: 'connection-old',
    });
    expect(getValidAccessToken).toHaveBeenCalledWith('user-1', 'connection-old');
    expect(canAccessFile).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("uses the library owner's Drive token for an authorized member", async () => {
    const getValidAccessToken = vi.fn().mockResolvedValue('owner-token');
    const count = vi.fn().mockResolvedValue(1);
    const service = new DriveAccessService(
      { libraryMembership: { count } } as unknown as PrismaClient,
      { getValidAccessToken } as unknown as GoogleOAuthService,
      {} as unknown as GoogleDriveService,
    );
    const file = {
      ...legacyFile(),
      googleConnectionId: 'owner-connection',
      library: {
        id: 'library-1',
        userId: 'owner-1',
        googleConnectionId: 'owner-connection',
      },
    };

    await expect(service.getAccess('listener-1', file)).resolves.toEqual({
      accessToken: 'owner-token',
      connectionId: 'owner-connection',
    });
    expect(count).toHaveBeenCalledWith({
      where: { libraryId: 'library-1', userId: 'listener-1' },
    });
    expect(getValidAccessToken).toHaveBeenCalledWith('owner-1', 'owner-connection');
  });

  it('repairs a legacy row with the account that can actually read the file', async () => {
    const file = legacyFile();
    const getConnectionsInfo = vi
      .fn()
      .mockResolvedValue([{ id: 'connection-old' }, { id: 'connection-new' }]);
    const getValidAccessToken = vi
      .fn()
      .mockImplementation((_userId: string, connectionId: string) =>
        Promise.resolve(`${connectionId}-token`),
      );
    const canAccessFile = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const update = vi.fn().mockResolvedValue({});
    const service = new DriveAccessService(
      { driveFile: { update } } as unknown as PrismaClient,
      { getConnectionsInfo, getValidAccessToken } as unknown as GoogleOAuthService,
      { canAccessFile } as unknown as GoogleDriveService,
    );

    await expect(service.getAccess('user-1', file)).resolves.toEqual({
      accessToken: 'connection-old-token',
      connectionId: 'connection-old',
    });
    expect(canAccessFile).toHaveBeenNthCalledWith(1, 'connection-new-token', 'google-file-1');
    expect(canAccessFile).toHaveBeenNthCalledWith(2, 'connection-old-token', 'google-file-1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'drive-row-1' },
      data: { googleConnectionId: 'connection-old' },
    });
    expect(file.googleConnectionId).toBe('connection-old');
  });
});

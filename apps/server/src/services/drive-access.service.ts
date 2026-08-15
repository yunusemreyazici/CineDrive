import type { PrismaClient } from '@prisma/client';
import { GoogleDriveService } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

type DriveFileAccessTarget = {
  id: string;
  googleDriveFileId: string | null;
  googleConnectionId: string | null;
  library: { id?: string; userId?: string; googleConnectionId: string | null } | null;
};

/** Resolves the Google credential that owns a Drive file, including legacy rows. */
export class DriveAccessService {
  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
    private driveService: GoogleDriveService,
  ) {}

  public async getAccess(
    userId: string,
    driveFile: DriveFileAccessTarget,
  ): Promise<{ accessToken: string; connectionId: string }> {
    if (!driveFile.googleDriveFileId) throw new Error('DRIVE_FILE_ID_MISSING');

    const canResolveLibrary = typeof this.prisma.driveFile?.findUnique === 'function';
    const resolvedLibrary =
      driveFile.library?.id && driveFile.library.userId
        ? { id: driveFile.library.id, userId: driveFile.library.userId }
        : canResolveLibrary
          ? await this.prisma.driveFile
            .findUnique({
              where: { id: driveFile.id },
              select: { library: { select: { id: true, userId: true } } },
            })
            .then((row) => row?.library || null)
          : { id: '', userId };
    if (!resolvedLibrary) throw new Error('LIBRARY_NOT_FOUND');
    if (resolvedLibrary.userId !== userId) {
      const membership = await this.prisma.libraryMembership.count({
        where: { libraryId: resolvedLibrary.id, userId },
      });
      if (!membership) throw new Error('DRIVE_FILE_FORBIDDEN');
    }
    const credentialUserId = resolvedLibrary.userId;

    // Rows written by current scans take the fast path with no extra Drive API request.
    if (driveFile.googleConnectionId) {
      return {
        accessToken: await this.googleOAuthService.getValidAccessToken(
          credentialUserId,
          driveFile.googleConnectionId,
        ),
        connectionId: driveFile.googleConnectionId,
      };
    }

    const connections = await this.googleOAuthService.getConnectionsInfo(credentialUserId);
    const preferredId = driveFile.library?.googleConnectionId;
    const candidates = preferredId
      ? [
          ...connections.filter((connection) => connection.id === preferredId),
          ...connections.filter((connection) => connection.id !== preferredId),
        ]
      : connections;

    for (const connection of candidates) {
      try {
        const accessToken = await this.googleOAuthService.getValidAccessToken(
          credentialUserId,
          connection.id,
        );
        if (!(await this.driveService.canAccessFile(accessToken, driveFile.googleDriveFileId))) {
          continue;
        }

        await this.prisma.driveFile.update({
          where: { id: driveFile.id },
          data: { googleConnectionId: connection.id },
        });
        driveFile.googleConnectionId = connection.id;
        return { accessToken, connectionId: connection.id };
      } catch {
        // A stale connection must not prevent trying the user's other accounts.
      }
    }

    throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
  }
}

import type { PrismaClient } from '@prisma/client';
import { GoogleDriveService } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

type DriveFileAccessTarget = {
  id: string;
  googleDriveFileId: string | null;
  googleConnectionId: string | null;
  library: { googleConnectionId: string | null } | null;
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

    // Rows written by current scans take the fast path with no extra Drive API request.
    if (driveFile.googleConnectionId) {
      return {
        accessToken: await this.googleOAuthService.getValidAccessToken(
          userId,
          driveFile.googleConnectionId,
        ),
        connectionId: driveFile.googleConnectionId,
      };
    }

    const connections = await this.googleOAuthService.getConnectionsInfo(userId);
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
          userId,
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

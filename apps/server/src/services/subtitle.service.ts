import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { convertSrtToVtt } from '@cinedrive/shared';
import { GoogleDriveService } from './drive.service.js';
import { DriveAccessService } from './drive-access.service.js';
import { decodeSubtitleBytes } from '../utils/subtitle-encoding.js';

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'subtitle_cache');
const MAX_SUBTITLE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB Max limit

export class SubtitleService {
  private driveService = new GoogleDriveService();

  constructor(
    private prisma: PrismaClient,
    private driveAccessService: DriveAccessService,
  ) {
    // Ensure cache directory exists on startup
    fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
  }

  /**
   * Fetches, converts (if SRT), caches, and returns WebVTT subtitle text content
   */
  public async getSubtitleWebVTT(userId: string, subtitleDriveFileId: string): Promise<string> {
    // 1. Verify SubtitleTrack in DB & check active library scope
    const track = await this.prisma.subtitleTrack.findFirst({
      where: {
        OR: [
          { driveFileId: subtitleDriveFileId },
          { id: subtitleDriveFileId },
          { driveFile: { googleDriveFileId: subtitleDriveFileId } },
        ],
      },
      include: {
        driveFile: {
          include: { library: true },
        },
      },
    });

    /*
     * `userId` was accepted and then ignored: the comment above promised a
     * library scope check but only the `active` status was tested, so any
     * signed-in account could read any account's subtitle content. A track the
     * caller does not own is reported as missing rather than forbidden.
     */
    if (
      !track ||
      track.driveFile.status !== 'active' ||
      (track.driveFile.library.userId !== userId &&
        !(await this.prisma.libraryMembership.count({
          where: { libraryId: track.driveFile.library.id, userId },
        })))
    ) {
      throw new Error('SUBTITLE_NOT_FOUND');
    }

    // 2. Max size check
    if (track.driveFile.size && track.driveFile.size > BigInt(MAX_SUBTITLE_SIZE_BYTES)) {
      throw new Error('SUBTITLE_FILE_TOO_LARGE');
    }

    // 3. Generate safe SHA-256 cache filename (prevents Path Traversal)
    const modifiedTime = track.driveFile.modifiedTime?.toISOString() || '1970';
    const checksum = track.driveFile.md5Checksum || 'nochecksum';
    const createCachePath = (version: 'v1' | 'v2') => {
      const cacheHash = crypto
        .createHash('sha256')
        .update(`${track.driveFile.googleDriveFileId}_${modifiedTime}_${checksum}_${version}`)
        .digest('hex');
      return path.join(CACHE_DIR, `${cacheHash}.vtt`);
    };
    const cacheFilePath = createCachePath('v2');

    // 4. Try reading from Disk Cache
    for (const candidatePath of [cacheFilePath, createCachePath('v1')]) {
      try {
        const cachedContent = await fs.readFile(candidatePath, 'utf-8');
        if (cachedContent) {
          if (candidatePath !== cacheFilePath) {
            fs.writeFile(cacheFilePath, cachedContent, 'utf-8').catch(() => {});
          }
          return cachedContent;
        }
      } catch {
        // Try the next cache generation before retrieving the source file.
      }
    }

    let rawContent: string;
    if (track.driveFile.storageType === 'local' && track.driveFile.localFilePath) {
      rawContent = decodeSubtitleBytes(await fs.readFile(track.driveFile.localFilePath));
    } else {
      const { accessToken } = await this.driveAccessService.getAccess(userId, track.driveFile);
      rawContent = await this.driveService.getFileTextContent(
        accessToken,
        track.driveFile.googleDriveFileId || '',
      );
    }

    // 6. Convert SRT to WebVTT if source format is SRT
    const isSrt =
      track.sourceFormat === 'srt' || track.driveFile.name.toLowerCase().endsWith('.srt');
    const vttContent = isSrt ? convertSrtToVtt(rawContent) : rawContent;

    // 7. Write to Disk Cache asynchronously (don't block if cache write fails)
    fs.writeFile(cacheFilePath, vttContent, 'utf-8').catch(() => {});

    return vttContent;
  }
}

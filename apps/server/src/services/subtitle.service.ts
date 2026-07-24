import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { convertSrtToVtt } from '@cinedrive/shared';
import { GoogleDriveService } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'subtitle_cache');
const MAX_SUBTITLE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB Max limit

export class SubtitleService {
  private driveService = new GoogleDriveService();

  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
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

    if (!track || track.driveFile.status !== 'active') {
      throw new Error('SUBTITLE_NOT_FOUND');
    }

    // 2. Max size check
    if (track.driveFile.size && track.driveFile.size > BigInt(MAX_SUBTITLE_SIZE_BYTES)) {
      throw new Error('SUBTITLE_FILE_TOO_LARGE');
    }

    // 3. Generate safe SHA-256 cache filename (prevents Path Traversal)
    const modifiedTime = track.driveFile.modifiedTime?.toISOString() || '1970';
    const checksum = track.driveFile.md5Checksum || 'nochecksum';
    const cacheHash = crypto
      .createHash('sha256')
      .update(`${track.driveFile.googleDriveFileId}_${modifiedTime}_${checksum}_v1`)
      .digest('hex');

    const cacheFilePath = path.join(CACHE_DIR, `${cacheHash}.vtt`);

    // 4. Try reading from Disk Cache
    try {
      const cachedContent = await fs.readFile(cacheFilePath, 'utf-8');
      if (cachedContent) {
        return cachedContent;
      }
    } catch {
      // Cache miss or read error, proceed to fetch & convert
    }

    // 5. Fetch raw text content from Google Drive
    const accessToken = await this.googleOAuthService.getValidAccessToken(userId);
    const rawContent = await this.driveService.getFileTextContent(
      accessToken,
      track.driveFile.googleDriveFileId,
    );

    // 6. Convert SRT to WebVTT if source format is SRT
    const isSrt =
      track.sourceFormat === 'srt' || track.driveFile.name.toLowerCase().endsWith('.srt');
    const vttContent = isSrt ? convertSrtToVtt(rawContent) : rawContent;

    // 7. Write to Disk Cache asynchronously (don't block if cache write fails)
    fs.writeFile(cacheFilePath, vttContent, 'utf-8').catch(() => {});

    return vttContent;
  }
}

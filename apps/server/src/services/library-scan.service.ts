import type { PrismaClient } from '@prisma/client';
import { parseMediaFilename } from '@cinedrive/shared';
import { GoogleDriveService, type DriveFileMetadata } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';

const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/x-matroska',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];

interface CustomFolderMetadata {
  type?: 'movie' | 'series';
  title?: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  genres?: string[];
  runtime?: number;
  posterFile?: string;
  backdropFile?: string;
}

export class LibraryScanService {
  private driveService = new GoogleDriveService();

  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
  ) {}

  private generateMediaItemId(type: string, normalizedTitle: string, year?: number): string {
    const safeTitle = normalizedTitle.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    return `media_${type}_${safeTitle}_${year || 0}`;
  }

  /**
   * Scans an entire media library starting from its rootFolderId
   */
  public async scanLibrary(userId: string, libraryId: string): Promise<string> {
    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
    });

    if (!library) {
      throw new Error('LIBRARY_NOT_FOUND');
    }

    const accessToken = await this.googleOAuthService.getValidAccessToken(userId);

    // Create LibraryScan record
    const scan = await this.prisma.libraryScan.create({
      data: {
        libraryId,
        status: 'running',
        startedAt: new Date(),
      },
    });

    const startTime = Date.now();
    let addedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    try {
      // Recursively scan root folder
      const result = await this.scanFolderRecursive(
        accessToken,
        libraryId,
        library.rootFolderId,
        scan.id,
      );

      addedCount = result.added;
      updatedCount = result.updated;
      errorCount = result.errors;

      const durationMs = Date.now() - startTime;

      await this.prisma.libraryScan.update({
        where: { id: scan.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          durationMs,
          addedCount,
          updatedCount,
          errorCount,
        },
      });

      await this.prisma.library.update({
        where: { id: libraryId },
        data: { lastScannedAt: new Date() },
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.prisma.libraryScan.update({
        where: { id: scan.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorCount: errorCount + 1,
        },
      });

      await this.prisma.libraryScanError.create({
        data: {
          scanId: scan.id,
          errorMessage: `Fatal scan error: ${errorMessage}`,
        },
      });

      throw err;
    }

    return scan.id;
  }

  private async scanFolderRecursive(
    accessToken: string,
    libraryId: string,
    folderId: string,
    scanId: string,
  ): Promise<{ added: number; updated: number; errors: number }> {
    let added = 0;
    let updated = 0;
    let errors = 0;

    // 1. Fetch all files & subfolders in current folder
    const allFiles: DriveFileMetadata[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.driveService.listFolderContents(accessToken, folderId, pageToken);
      allFiles.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);

    // 2. Separate into folders, videos, images, subtitles, metadata
    const subfolders = allFiles.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    const videos = allFiles.filter(
      (f) => VIDEO_MIME_TYPES.includes(f.mimeType) || this.isVideoExtension(f.name),
    );
    const metadataFile = allFiles.find((f) => f.name.toLowerCase() === 'metadata.json');

    // 3. Read metadata.json if present
    let customMeta: CustomFolderMetadata | null = null;
    if (metadataFile) {
      try {
        const text = await this.driveService.getFileTextContent(accessToken, metadataFile.id);
        customMeta = JSON.parse(text) as CustomFolderMetadata;
      } catch (e: unknown) {
        errors++;
        await this.prisma.libraryScanError.create({
          data: {
            scanId,
            driveFileId: metadataFile.id,
            errorMessage: `Failed to parse metadata.json: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    }

    // 4. Find Posters & Backdrops in current folder
    const posterFile = allFiles.find((f) =>
      customMeta?.posterFile
        ? f.name.toLowerCase() === customMeta.posterFile.toLowerCase()
        : f.name.toLowerCase().startsWith('poster.'),
    );

    const backdropFile = allFiles.find((f) =>
      customMeta?.backdropFile
        ? f.name.toLowerCase() === customMeta.backdropFile.toLowerCase()
        : f.name.toLowerCase().startsWith('backdrop.') || f.name.toLowerCase().startsWith('fanart.'),
    );

    // Index Poster & Backdrop in DriveFile DB
    if (posterFile) {
      await this.upsertDriveFile(libraryId, posterFile);
    }
    if (backdropFile) {
      await this.upsertDriveFile(libraryId, backdropFile);
    }

    // 5. Process Videos in Current Folder
    for (const video of videos) {
      try {
        const driveFile = await this.upsertDriveFile(libraryId, video);
        if (driveFile.isNew) added++;
        else updated++;

        const parsedName = parseMediaFilename(video.name);
        const title = customMeta?.title || parsedName.title;
        const normalizedTitle = title.toLowerCase();
        const year = customMeta?.year || parsedName.year;
        const type = customMeta?.type || parsedName.type;

        const durationSec = video.videoMediaMetadata?.durationMillis
          ? parseFloat(String(video.videoMediaMetadata.durationMillis)) / 1000
          : undefined;

        const mediaItemId = this.generateMediaItemId(type, normalizedTitle, year);

        // Upsert MediaItem
        const mediaItem = await this.prisma.mediaItem.upsert({
          where: { id: mediaItemId },
          create: {
            id: mediaItemId,
            type,
            title,
            originalTitle: customMeta?.originalTitle,
            normalizedTitle,
            year,
            overview: customMeta?.overview,
            posterDriveFileId: posterFile?.id,
            backdropDriveFileId: backdropFile?.id,
            duration: durationSec,
          },
          update: {
            title,
            year,
            posterDriveFileId: posterFile?.id || undefined,
            backdropDriveFileId: backdropFile?.id || undefined,
          },
        });

        if (type === 'movie') {
          await this.prisma.movie.upsert({
            where: { mediaItemId: mediaItem.id },
            create: {
              mediaItemId: mediaItem.id,
              driveFileId: driveFile.record.id,
            },
            update: {
              driveFileId: driveFile.record.id,
            },
          });
        } else {
          // Series Episode Processing
          const series = await this.prisma.series.upsert({
            where: { mediaItemId: mediaItem.id },
            create: { mediaItemId: mediaItem.id },
            update: {},
          });

          const seasonNumber = parsedName.seasonNumber || 1;
          const episodeNumber = parsedName.episodeNumber || 1;

          const season = await this.prisma.season.upsert({
            where: {
              seriesId_seasonNumber: {
                seriesId: series.id,
                seasonNumber,
              },
            },
            create: {
              seriesId: series.id,
              seasonNumber,
              name: `Season ${seasonNumber}`,
            },
            update: {},
          });

          const episode = await this.prisma.episode.upsert({
            where: {
              seasonId_episodeNumber: {
                seasonId: season.id,
                episodeNumber,
              },
            },
            create: {
              seriesId: series.id,
              seasonId: season.id,
              mediaItemId: mediaItem.id,
              driveFileId: driveFile.record.id,
              seasonNumber,
              episodeNumber,
              title: video.name.replace(/\.[^/.]+$/, ''),
              duration: durationSec,
            },
            update: {
              driveFileId: driveFile.record.id,
            },
          });

          // Match Subtitles for this episode
          await this.matchSubtitles(accessToken, libraryId, allFiles, video.name, episode.id);
        }
      } catch (err: unknown) {
        errors++;
        await this.prisma.libraryScanError.create({
          data: {
            scanId,
            driveFileId: video.id,
            errorMessage: `Error processing video file ${video.name}: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      }
    }

    // 6. Recurse into Subfolders
    for (const folder of subfolders) {
      const subResult = await this.scanFolderRecursive(
        accessToken,
        libraryId,
        folder.id,
        scanId,
      );
      added += subResult.added;
      updated += subResult.updated;
      errors += subResult.errors;
    }

    return { added, updated, errors };
  }

  private async upsertDriveFile(libraryId: string, file: DriveFileMetadata) {
    const existing = await this.prisma.driveFile.findUnique({
      where: { googleDriveFileId: file.id },
    });

    const record = await this.prisma.driveFile.upsert({
      where: { googleDriveFileId: file.id },
      create: {
        libraryId,
        googleDriveFileId: file.id,
        parentDriveFileId: file.parents?.[0] || null,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? BigInt(file.size) : null,
        modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
        md5Checksum: file.md5Checksum || null,
        status: 'active',
      },
      update: {
        name: file.name,
        size: file.size ? BigInt(file.size) : null,
        modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
        status: 'active',
      },
    });

    return { record, isNew: !existing };
  }

  private async matchSubtitles(
    _accessToken: string,
    libraryId: string,
    allFiles: DriveFileMetadata[],
    videoName: string,
    episodeId: string,
  ) {
    const videoBase = videoName.replace(/\.[^/.]+$/, '').toLowerCase();
    const subtitles = allFiles.filter(
      (f) =>
        (f.name.endsWith('.vtt') || f.name.endsWith('.srt')) &&
        f.name.toLowerCase().startsWith(videoBase),
    );

    for (const sub of subtitles) {
      const driveFile = await this.upsertDriveFile(libraryId, sub);

      const langMatch = sub.name.match(/\.(tr|en|de|fr|es|it)\.(vtt|srt)$/i);
      const language = langMatch?.[1]?.toLowerCase() || 'tr';
      const isForced = sub.name.toLowerCase().includes('.forced.');
      const isHearingImpaired = sub.name.toLowerCase().includes('.hi.') || sub.name.toLowerCase().includes('.sdh.');

      await this.prisma.subtitleTrack.upsert({
        where: { id: `sub_${episodeId}_${driveFile.record.id}` },
        create: {
          id: `sub_${episodeId}_${driveFile.record.id}`,
          episodeId,
          driveFileId: driveFile.record.id,
          language,
          label: `${language.toUpperCase()}${isForced ? ' (Forced)' : ''}`,
          isForced,
          isHearingImpaired,
        },
        update: {
          language,
          isForced,
          isHearingImpaired,
        },
      });
    }
  }

  private isVideoExtension(filename: string): boolean {
    const lower = filename.toLowerCase();
    return (
      lower.endsWith('.mp4') ||
      lower.endsWith('.mkv') ||
      lower.endsWith('.webm') ||
      lower.endsWith('.m4v')
    );
  }
}

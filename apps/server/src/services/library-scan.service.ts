import type { PrismaClient } from '@prisma/client';
import { parseMediaFilename, parseSubtitleFilename } from '@cinedrive/shared';
import { GoogleDriveService, type DriveFileMetadata } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { MetadataService } from './metadata.service.js';

const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/x-matroska',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];



export class LibraryScanService {
  private driveService = new GoogleDriveService();
  private metadataService = new MetadataService();
  private activeScans = new Set<string>();

  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
  ) {}

  private generateMediaItemId(type: string, normalizedTitle: string): string {
    const safeTitle = normalizedTitle.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return `media_${type}_${safeTitle}`;
  }

  /**
   * Scans all connected Google Drive accounts and Shared Drives without folder restrictions
   */
  public async scanLibrary(userId: string, libraryId: string): Promise<string> {
    if (this.activeScans.has(libraryId)) {
      throw new Error('SCAN_ALREADY_IN_PROGRESS');
    }

    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
    });

    if (!library) {
      throw new Error('LIBRARY_NOT_FOUND');
    }

    const connections = await this.googleOAuthService.getConnectionsInfo(userId);
    if (connections.length === 0) {
      throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    }

    // Acquire lock
    this.activeScans.add(libraryId);

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
      let activeConnectionsCount = 0;
      // Scan files across ALL connected Google accounts & Shared Drives
      for (const connection of connections) {
        let accessToken: string;
        try {
          accessToken = await this.googleOAuthService.getValidAccessToken(userId, connection.id);
          activeConnectionsCount++;
        } catch (authErr) {
          if (connections.length === 1) {
            throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
          }
          continue;
        }

        const result = await this.scanAccountFiles(
          accessToken,
          libraryId,
          scan.id,
          connection.id,
        );

        addedCount += result.added;
        updatedCount += result.updated;
        errorCount += result.errors;
      }

      if (activeConnectionsCount === 0) {
        throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
      }

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
    } finally {
      // Release lock
      this.activeScans.delete(libraryId);
    }

    return scan.id;
  }

  private async scanAccountFiles(
    accessToken: string,
    libraryId: string,
    scanId: string,
    connectionId: string,
  ): Promise<{ added: number; updated: number; errors: number }> {
    let added = 0;
    let updated = 0;
    let errors = 0;

    // 1. Fetch ALL files across the entire Google Drive account (including Shared Drives)
    const allFiles: DriveFileMetadata[] = [];
    let pageToken: string | undefined;

    try {
      do {
        const page = await this.driveService.listAccountFiles(accessToken, pageToken);
        allFiles.push(...page.files);
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err: unknown) {
      const isAuthErr =
        err instanceof Error &&
        (err.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED' ||
          err.message === 'GOOGLE_REAUTHORIZATION_REQUIRED' ||
          err.message.includes('401') ||
          err.message.includes('invalid_grant') ||
          err.message.includes('File not found'));

      if (isAuthErr) {
        throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
      }

      errors++;
      await this.prisma.libraryScanError.create({
        data: {
          scanId,
          errorMessage: `Google Drive account file listing failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
      return { added, updated, errors };
    }

    // 2. Separate into videos, images, subtitles, metadata
    const videos = allFiles.filter(
      (f) => VIDEO_MIME_TYPES.includes(f.mimeType) || this.isVideoExtension(f.name),
    );

    // Link library to active google connection
    await this.prisma.library.update({
      where: { id: libraryId },
      data: { googleConnectionId: connectionId },
    }).catch(() => {});

    // 3. Process Videos across account
    for (const video of videos) {
      try {
        const driveFile = await this.upsertDriveFile(libraryId, video);
        if (driveFile.isNew) added++;
        else updated++;

        const parsedName = parseMediaFilename(video.name);
        const title = parsedName.title;
        const normalizedTitle = title.toLowerCase();
        const year = parsedName.year;
        const type = parsedName.type;

        const durationSec = video.videoMediaMetadata?.durationMillis
          ? parseFloat(String(video.videoMediaMetadata.durationMillis)) / 1000
          : undefined;

        let onlinePosterUrl: string | null = null;
        let onlineBackdropUrl: string | null = null;
        let overview: string | null = null;
        let finalYear = year;
        let voteAverage: number | undefined;
        let voteCount: number | undefined;
        let genresStr: string | undefined;
        let castStr: string | undefined;
        let trailerUrl: string | undefined;
        let contentRating: string | undefined;
        let tmdbId: number | undefined;
        let imdbId: string | undefined;

        const onlineMeta = await this.metadataService.fetchMetadata(title, type as 'movie' | 'series');
        if (onlineMeta) {
          onlinePosterUrl = onlineMeta.posterUrl;
          onlineBackdropUrl = onlineMeta.backdropUrl;
          overview = onlineMeta.overview || null;
          if (!finalYear && onlineMeta.year) finalYear = onlineMeta.year;
          if (onlineMeta.voteAverage !== undefined) voteAverage = onlineMeta.voteAverage;
          if (onlineMeta.voteCount !== undefined) voteCount = onlineMeta.voteCount;
          if (onlineMeta.genres) genresStr = JSON.stringify(onlineMeta.genres);
          if (onlineMeta.cast) castStr = JSON.stringify(onlineMeta.cast);
          if (onlineMeta.trailerUrl) trailerUrl = onlineMeta.trailerUrl;
          if (onlineMeta.contentRating) contentRating = onlineMeta.contentRating;
          if (onlineMeta.tmdbId) tmdbId = onlineMeta.tmdbId;
          if (onlineMeta.imdbId) imdbId = onlineMeta.imdbId;
        }

        const mediaItemId = this.generateMediaItemId(type, normalizedTitle);

        // Upsert MediaItem
        const mediaItem = await this.prisma.mediaItem.upsert({
          where: { id: mediaItemId },
          create: {
            id: mediaItemId,
            type,
            title,
            normalizedTitle,
            year: finalYear,
            overview,
            posterUrl: onlinePosterUrl,
            backdropUrl: onlineBackdropUrl,
            duration: durationSec,
            voteAverage,
            voteCount,
            genres: genresStr,
            cast: castStr,
            trailerUrl,
            contentRating,
            tmdbId,
            imdbId,
          },
          update: {
            title,
            year: finalYear,
            overview: overview || undefined,
            posterUrl: onlinePosterUrl || undefined,
            backdropUrl: onlineBackdropUrl || undefined,
            voteAverage: voteAverage || undefined,
            voteCount: voteCount || undefined,
            genres: genresStr || undefined,
            cast: castStr || undefined,
            trailerUrl: trailerUrl || undefined,
            contentRating: contentRating || undefined,
            tmdbId: tmdbId || undefined,
            imdbId: imdbId || undefined,
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

          // Match Subtitles for this Movie
          await this.matchSubtitles(libraryId, allFiles, video.name, { mediaItemId: mediaItem.id });
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
              name: `Sezon ${seasonNumber}`,
            },
            update: {},
          });

          const epMetaMap = await this.metadataService.fetchShowEpisodes(title);
          const epMeta = epMetaMap.get(`${seasonNumber}x${episodeNumber}`);

          const epTitle = epMeta?.name || video.name.replace(/\.[^/.]+$/, '');
          const epOverview = epMeta?.overview || null;
          const epStillUrl = epMeta?.stillUrl || null;

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
              title: epTitle,
              overview: epOverview,
              stillUrl: epStillUrl,
              duration: durationSec,
            },
            update: {
              driveFileId: driveFile.record.id,
              title: epTitle,
              overview: epOverview || undefined,
              stillUrl: epStillUrl || undefined,
            },
          });

          // Match Subtitles for this Episode
          await this.matchSubtitles(libraryId, allFiles, video.name, { episodeId: episode.id });
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
    libraryId: string,
    allFiles: DriveFileMetadata[],
    videoName: string,
    target: { mediaItemId?: string; episodeId?: string },
  ) {
    const videoBase = videoName.replace(/\.[^/.]+$/, '').toLowerCase();
    const subtitles = allFiles.filter(
      (f) =>
        (f.name.endsWith('.vtt') || f.name.endsWith('.srt')) &&
        f.name.toLowerCase().startsWith(videoBase),
    );

    for (const sub of subtitles) {
      const driveFile = await this.upsertDriveFile(libraryId, sub);
      const parsedSub = parseSubtitleFilename(sub.name);

      await this.prisma.subtitleTrack.upsert({
        where: { driveFileId: driveFile.record.id },
        create: {
          mediaItemId: target.mediaItemId || null,
          episodeId: target.episodeId || null,
          driveFileId: driveFile.record.id,
          language: parsedSub.languageCode,
          label: parsedSub.languageLabel,
          isForced: parsedSub.forced,
          isHearingImpaired: parsedSub.hearingImpaired,
          isDefault: parsedSub.isDefault,
          sourceFormat: parsedSub.sourceFormat,
        },
        update: {
          language: parsedSub.languageCode,
          label: parsedSub.languageLabel,
          isForced: parsedSub.forced,
          isHearingImpaired: parsedSub.hearingImpaired,
          isDefault: parsedSub.isDefault,
          sourceFormat: parsedSub.sourceFormat,
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
      lower.endsWith('.m4v') ||
      lower.endsWith('.avi') ||
      lower.endsWith('.mov') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.m2ts') ||
      lower.endsWith('.flv') ||
      lower.endsWith('.wmv') ||
      lower.endsWith('.3gp')
    );
  }
}

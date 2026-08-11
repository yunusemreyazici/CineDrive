import type { PrismaClient } from '@prisma/client';
import { parseMediaFilename, parseSubtitleFilename } from '@cinedrive/shared';
import { GoogleDriveService, type DriveFileMetadata } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { MetadataService } from './metadata.service.js';
import { MediaProbeService } from './media-probe.service.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { MusicLibraryService } from './music-library.service.js';
import { isAudioFilename } from './music-metadata.service.js';

// Each probe issues a handful of ranged Drive reads. Enough of them run at once
// to hide the latency, few enough to stay well inside Google's per-user quota.
const MEDIA_PROBE_CONCURRENCY = 4;

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
  private mediaProbeService = new MediaProbeService();
  private musicLibraryService: MusicLibraryService;
  private activeScans = new Set<string>();

  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
  ) {
    this.musicLibraryService = new MusicLibraryService(prisma);
  }

  private generateMediaItemId(type: string, normalizedTitle: string): string {
    const safeTitle = normalizedTitle
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `media_${type}_${safeTitle}`;
  }

  public isScanning(libraryId: string): boolean {
    return this.activeScans.has(libraryId);
  }

  /**
   * Scans all connected Google Drive accounts and Shared Drives asynchronously in the background
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

    const allConnections = await this.googleOAuthService.getConnectionsInfo(userId);
    const connections = library.googleConnectionId
      ? allConnections.filter((connection) => connection.id === library.googleConnectionId)
      : allConnections;
    if (connections.length === 0) {
      throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    }

    // Verify at least 1 connection can retrieve access token before acquiring lock
    let validTokenFound = false;
    for (const connection of connections) {
      try {
        await this.googleOAuthService.getValidAccessToken(userId, connection.id);
        validTokenFound = true;
        break;
      } catch {
        // Check next connection
      }
    }

    if (!validTokenFound) {
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

    // Launch scan execution asynchronously in background
    this.executeScanAsync(userId, libraryId, scan.id, connections, library.rootFolderId).catch(
      () => {},
    );

    return scan.id;
  }

  private async executeScanAsync(
    userId: string,
    libraryId: string,
    scanId: string,
    connections: Array<{ id: string }>,
    rootFolderId: string,
  ): Promise<void> {
    const startTime = Date.now();
    let addedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    try {
      for (const connection of connections) {
        let accessToken: string;
        try {
          accessToken = await this.googleOAuthService.getValidAccessToken(userId, connection.id);
        } catch {
          continue;
        }

        const result = await this.scanAccountFiles(
          userId,
          accessToken,
          connection.id,
          libraryId,
          scanId,
          rootFolderId,
        );

        addedCount += result.added;
        updatedCount += result.updated;
        errorCount += result.errors;
      }

      const durationMs = Date.now() - startTime;

      await this.prisma.libraryScan.update({
        where: { id: scanId },
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
        where: { id: scanId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorCount: errorCount + 1,
        },
      });

      await this.prisma.libraryScanError.create({
        data: {
          scanId,
          errorMessage: `Fatal scan error: ${errorMessage}`,
        },
      });
    } finally {
      this.activeScans.delete(libraryId);
    }
  }

  private async scanAccountFiles(
    userId: string,
    accessToken: string,
    googleConnectionId: string,
    libraryId: string,
    scanId: string,
    rootFolderId: string,
  ): Promise<{ added: number; updated: number; errors: number }> {
    let added = 0;
    let updated = 0;
    let errors = 0;

    // An empty root folder scans the whole account. Otherwise only the selected
    // folder and its descendants are included.
    const allFiles: DriveFileMetadata[] = [];

    try {
      if (rootFolderId.trim()) {
        allFiles.push(...(await this.listFolderTree(accessToken, rootFolderId.trim())));
      } else {
        let pageToken: string | undefined;
        do {
          const page = await this.driveService.listAccountFiles(accessToken, pageToken);
          allFiles.push(...page.files);
          pageToken = page.nextPageToken;
        } while (pageToken);
      }
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
    const audioFiles = allFiles.filter(
      (file) => file.mimeType.startsWith('audio/') || isAudioFilename(file.name),
    );
    const lyricsFiles = allFiles.filter((file) => file.name.toLowerCase().endsWith('.lrc'));

    // Codec probing reads byte ranges straight from Drive and writes only its
    // own row, so it is independent of everything else in the loop. Collected
    // here and drained concurrently after the pass instead of adding a network
    // round trip per file to the critical path.
    const pendingProbes: Array<{
      driveFileId: string;
      name: string;
      size: string;
      fileId: string;
    }> = [];

    // 3. Process Videos across account
    for (const video of videos) {
      try {
        const driveFile = await this.upsertDriveFile(libraryId, googleConnectionId, video);
        if (driveFile.isNew) added++;
        else if (driveFile.sourceChanged) updated++;

        if (driveFile.needsMediaAnalysis && video.size) {
          pendingProbes.push({
            driveFileId: driveFile.record.id,
            name: video.name,
            size: String(video.size),
            fileId: video.id,
          });
        }

        // Live progress update on LibraryScan record in DB
        await this.prisma.libraryScan
          .update({
            where: { id: scanId },
            data: {
              addedCount: added,
              updatedCount: updated,
              errorCount: errors,
            },
          })
          .catch(() => {});

        const parsedName = parseMediaFilename(video.name);
        const title = parsedName.title;
        const normalizedTitle = title.toLowerCase();
        const year = parsedName.year;
        const type = parsedName.type;
        const mediaItemId = this.generateMediaItemId(type, normalizedTitle);
        const existingMediaItem = await this.prisma.mediaItem.findUnique({
          where: { id: mediaItemId },
        });

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

        const shouldRefreshMetadata =
          driveFile.isNew ||
          driveFile.sourceChanged ||
          !existingMediaItem ||
          !existingMediaItem.tmdbId;
        const onlineMeta = shouldRefreshMetadata
          ? await this.metadataService.fetchMetadata(title, type as 'movie' | 'series')
          : null;
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

        // Upsert MediaItem
        const mediaItem = await this.prisma.mediaItem.upsert({
          where: { id: mediaItemId },
          create: {
            id: mediaItemId,
            // Recorded at scan time so ownership is one indexed column rather
            // than a walk through movie/episode -> driveFile -> library.
            libraryId,
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
            // A rescan re-homes the record to the library that just found it.
            libraryId,
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
          await this.matchSubtitles(libraryId, googleConnectionId, allFiles, video.name, {
            mediaItemId: mediaItem.id,
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
              name: `Sezon ${seasonNumber}`,
            },
            update: {},
          });

          const existingEpisode = await this.prisma.episode.findUnique({
            where: {
              seasonId_episodeNumber: {
                seasonId: season.id,
                episodeNumber,
              },
            },
          });
          const epMetaMap =
            driveFile.isNew ||
            driveFile.sourceChanged ||
            !existingEpisode ||
            !existingEpisode.stillUrl
              ? await this.metadataService.fetchShowEpisodes(title)
              : new Map();
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
          await this.matchSubtitles(libraryId, googleConnectionId, allFiles, video.name, {
            episodeId: episode.id,
          });
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

    for (const audio of audioFiles) {
      try {
        const driveFile = await this.upsertDriveFile(libraryId, googleConnectionId, audio);
        if (driveFile.isNew) added++;
        else if (driveFile.sourceChanged) updated++;
        if (!audio.size) throw new Error('AUDIO_SIZE_MISSING');
        const parsed = await this.musicLibraryService.metadata.parseRemoteFile({
          name: audio.name,
          size: BigInt(audio.size),
          readRange: (start, end) =>
            this.driveService.getMediaRangeBuffer(accessToken, audio.id, start, end),
        });
        await this.prisma.driveFile.update({
          where: { id: driveFile.record.id },
          data: {
            mediaContainer: parsed.container,
            audioCodec: parsed.codec,
            audioChannels: parsed.channels,
            audioSampleRate: parsed.sampleRate,
            audioBitrate: parsed.bitrate,
            audioBitDepth: parsed.bitDepth,
            audioLossless: parsed.lossless,
            mediaDuration: parsed.duration,
            mediaAnalyzedAt: new Date(),
            mediaAnalysisError: null,
          },
        });
        const track = await this.musicLibraryService.indexTrack({
          userId,
          libraryId,
          driveFileId: driveFile.record.id,
          metadata: parsed,
        });
        const audioBase = audio.name.replace(/\.[^/.]+$/, '').toLowerCase();
        const audioParent = audio.parents?.[0];
        const matchingLyrics = lyricsFiles
          .filter((candidate) => {
            if ((candidate.parents?.[0] || null) !== (audioParent || null)) return false;
            const lyricsBase = candidate.name.replace(/\.lrc$/i, '').toLowerCase();
            return lyricsBase === audioBase || lyricsBase.startsWith(`${audioBase}.`);
          })
          .sort((left, right) => {
            const leftExact = left.name.replace(/\.lrc$/i, '').toLowerCase() === audioBase ? 0 : 1;
            const rightExact =
              right.name.replace(/\.lrc$/i, '').toLowerCase() === audioBase ? 0 : 1;
            return leftExact - rightExact || left.name.localeCompare(right.name);
          })[0];
        try {
          if (matchingLyrics) {
            await this.musicLibraryService.lyrics.syncTrackLyrics({
              trackId: track.id,
              sourceName: matchingLyrics.name,
              content: await this.driveService.getFileTextContent(accessToken, matchingLyrics.id),
            });
          } else {
            await this.musicLibraryService.lyrics.removeSidecarLyrics(track.id);
          }
        } catch (lyricsError) {
          errors++;
          await this.prisma.libraryScanError.create({
            data: {
              scanId,
              driveFileId: driveFile.record.id,
              errorMessage: `LRC dosyası işlenemedi (${matchingLyrics?.name || audio.name}): ${lyricsError instanceof Error ? lyricsError.message : String(lyricsError)}`,
            },
          });
        }
        await this.prisma.libraryScan
          .update({
            where: { id: scanId },
            data: { addedCount: added, updatedCount: updated, errorCount: errors },
          })
          .catch(() => {});
      } catch (error) {
        errors++;
        await this.prisma.libraryScanError.create({
          data: {
            scanId,
            driveFileId: audio.id,
            errorMessage: `Ses dosyası işlenemedi (${audio.name}): ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    }

    await runWithConcurrency(pendingProbes, MEDIA_PROBE_CONCURRENCY, async (probe) => {
      try {
        const technicalMetadata = await this.mediaProbeService.probeRemoteFile({
          name: probe.name,
          size: BigInt(probe.size),
          readRange: (start, end) =>
            this.driveService.getMediaRangeBuffer(accessToken, probe.fileId, start, end),
        });
        await this.prisma.driveFile.update({
          where: { id: probe.driveFileId },
          data: technicalMetadata,
        });
      } catch (error) {
        // A file that cannot be probed still belongs in the library; the
        // failure is recorded on the row so Media Health can surface it.
        await this.prisma.driveFile
          .update({
            where: { id: probe.driveFileId },
            data: {
              mediaAnalyzedAt: new Date(),
              mediaAnalysisError:
                error instanceof Error ? error.message.slice(0, 500) : 'REMOTE_MEDIA_PROBE_FAILED',
            },
          })
          .catch(() => {});
      }
    });

    return { added, updated, errors };
  }

  private async listFolderTree(
    accessToken: string,
    rootFolderId: string,
  ): Promise<DriveFileMetadata[]> {
    const files: DriveFileMetadata[] = [];
    const pendingFolderIds = [rootFolderId];
    const visitedFolderIds = new Set<string>();

    while (pendingFolderIds.length > 0) {
      const folderId = pendingFolderIds.shift()!;
      if (visitedFolderIds.has(folderId)) continue;
      visitedFolderIds.add(folderId);

      let pageToken: string | undefined;
      do {
        const page = await this.driveService.listFolderContents(accessToken, folderId, pageToken);

        for (const file of page.files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            pendingFolderIds.push(file.id);
          } else {
            files.push(file);
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }

    return files;
  }

  private async upsertDriveFile(
    libraryId: string,
    googleConnectionId: string,
    file: DriveFileMetadata,
  ) {
    const existing = await this.prisma.driveFile.findUnique({
      where: { googleDriveFileId: file.id },
    });
    const nextModifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;
    const sourceChanged =
      !!existing &&
      (existing.size !== (file.size ? BigInt(file.size) : null) ||
        existing.modifiedTime?.getTime() !== nextModifiedTime?.getTime() ||
        existing.md5Checksum !== (file.md5Checksum || null));

    const record = await this.prisma.driveFile.upsert({
      where: { googleDriveFileId: file.id },
      create: {
        libraryId,
        googleConnectionId,
        googleDriveFileId: file.id,
        parentDriveFileId: file.parents?.[0] || null,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? BigInt(file.size) : null,
        modifiedTime: nextModifiedTime,
        md5Checksum: file.md5Checksum || null,
        status: 'active',
      },
      update: {
        libraryId,
        googleConnectionId,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? BigInt(file.size) : null,
        modifiedTime: nextModifiedTime,
        md5Checksum: file.md5Checksum || null,
        status: 'active',
        ...(sourceChanged
          ? {
              mediaAnalyzedAt: null,
              mediaAnalysisError: null,
              mediaContainer: null,
              videoCodec: null,
              videoProfile: null,
              videoBitDepth: null,
              audioCodec: null,
              audioChannels: null,
              audioSampleRate: null,
              audioBitrate: null,
              audioBitDepth: null,
              audioLossless: null,
              mediaWidth: null,
              mediaHeight: null,
              mediaDuration: null,
            }
          : {}),
      },
    });

    return {
      record,
      isNew: !existing,
      sourceChanged,
      needsMediaAnalysis: !existing?.mediaAnalyzedAt || sourceChanged,
    };
  }

  private async matchSubtitles(
    libraryId: string,
    googleConnectionId: string,
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
      const driveFile = await this.upsertDriveFile(libraryId, googleConnectionId, sub);
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

import type { PrismaClient } from '@prisma/client';
import { parseMediaFilename, parseSubtitleFilename } from '@cinedrive/shared';
import { GoogleDriveService, type DriveFileMetadata } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { MetadataService } from './metadata.service.js';
import { MediaProbeService } from './media-probe.service.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { MusicLibraryService } from './music-library.service.js';
import { isAudioFilename, isPlaylistFilename } from './music-metadata.service.js';
import type { ScanLifecycleService } from './scan-lifecycle.service.js';
import { isDriveVideoFile } from './media-file-types.js';

// Each probe issues a handful of ranged Drive reads. Enough of them run at once
// to hide the latency, few enough to stay well inside Google's per-user quota.
const MEDIA_PROBE_CONCURRENCY = 4;

interface DriveScanTarget {
  connection: { id: string };
  rootFolderId: string;
  sourceId: string | null;
}

export class LibraryScanService {
  private driveService = new GoogleDriveService();
  private metadataService = new MetadataService();
  private mediaProbeService = new MediaProbeService();
  private musicLibraryService: MusicLibraryService;
  private activeLibraryScans = new Set<string>();
  private activeSourceScans = new Map<string, string>();

  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
    private scanLifecycle: ScanLifecycleService,
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
    return (
      this.activeLibraryScans.has(libraryId) ||
      Array.from(this.activeSourceScans.values()).some(
        (activeLibraryId) => activeLibraryId === libraryId,
      )
    );
  }

  /**
   * Scans all connected Google Drive accounts and Shared Drives asynchronously in the background
   */
  public async scanLibrary(userId: string, libraryId: string): Promise<string> {
    if (this.isScanning(libraryId)) {
      throw new Error('SCAN_ALREADY_IN_PROGRESS');
    }

    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
    });

    if (!library) {
      throw new Error('LIBRARY_NOT_FOUND');
    }

    const allConnections = await this.googleOAuthService.getConnectionsInfo(userId);
    const savedSources = await this.prisma.driveScanSource.findMany({
      where: { libraryId, googleConnection: { userId } },
      orderBy: { createdAt: 'asc' },
    });
    const targets = savedSources.length
      ? savedSources.flatMap((source) => {
          const connection = allConnections.find((item) => item.id === source.googleConnectionId);
          return connection
            ? [{ connection, rootFolderId: source.rootFolderId, sourceId: source.id }]
            : [];
        })
      : (library.googleConnectionId
          ? allConnections.filter((connection) => connection.id === library.googleConnectionId)
          : allConnections
        ).map((connection) => ({
          connection,
          rootFolderId: library.rootFolderId,
          sourceId: null,
        }));
    if (targets.length === 0) {
      throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    }

    // Verify at least 1 connection can retrieve access token before acquiring lock
    let validTokenFound = false;
    for (const target of targets) {
      try {
        await this.googleOAuthService.getValidAccessToken(userId, target.connection.id);
        validTokenFound = true;
        break;
      } catch {
        // Check next connection
      }
    }

    if (!validTokenFound) {
      throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    }

    return this.startScan(userId, libraryId, targets);
  }

  /** Scan one saved Drive source without walking the other accounts/folders. */
  public async scanSource(userId: string, libraryId: string, sourceId: string): Promise<string> {
    if (this.activeLibraryScans.has(libraryId) || this.activeSourceScans.has(sourceId)) {
      throw new Error('SCAN_ALREADY_IN_PROGRESS');
    }

    const source = await this.prisma.driveScanSource.findFirst({
      where: {
        id: sourceId,
        libraryId,
        googleConnection: { userId },
      },
    });
    if (!source) {
      throw new Error('DRIVE_SOURCE_NOT_FOUND');
    }

    const connections = await this.googleOAuthService.getConnectionsInfo(userId);
    const connection = connections.find((item) => item.id === source.googleConnectionId);
    if (!connection) {
      throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    }

    await this.googleOAuthService.getValidAccessToken(userId, connection.id);

    return this.startScan(
      userId,
      libraryId,
      [
        {
          connection,
          rootFolderId: source.rootFolderId,
          sourceId: source.id,
        },
      ],
      source.id,
    );
  }

  private async startScan(
    userId: string,
    libraryId: string,
    targets: DriveScanTarget[],
    exclusiveSourceId?: string,
  ): Promise<string> {
    // Token checks happen before this method, so repeat the lock check to close
    // the small race between two requests validating access simultaneously.
    if (
      this.activeLibraryScans.has(libraryId) ||
      (exclusiveSourceId
        ? this.activeSourceScans.has(exclusiveSourceId)
        : Array.from(this.activeSourceScans.values()).some(
            (activeLibraryId) => activeLibraryId === libraryId,
          ))
    ) {
      throw new Error('SCAN_ALREADY_IN_PROGRESS');
    }
    if (exclusiveSourceId) this.activeSourceScans.set(exclusiveSourceId, libraryId);
    else this.activeLibraryScans.add(libraryId);

    try {
      const sourceIds = targets.flatMap((target) => (target.sourceId ? [target.sourceId] : []));
      if (sourceIds.length > 0) {
        await this.prisma.driveScanSource.updateMany({
          where: { id: { in: sourceIds } },
          data: {
            lastScanStatus: 'running',
            lastScannedAt: new Date(),
            lastScanDurationMs: null,
            lastScanAddedCount: 0,
            lastScanUpdatedCount: 0,
            lastScanDeletedCount: 0,
            lastScanErrorCount: 0,
            lastScanError: null,
            lastScanInterruptionReason: null,
          },
        });
      }
      const scan = await this.prisma.libraryScan.create({
        data: {
          libraryId,
          driveScanSourceId: targets.length === 1 ? targets[0]?.sourceId : null,
          status: 'running',
          startedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      const signal = this.scanLifecycle.register(scan.id, libraryId, sourceIds, () => {
        if (exclusiveSourceId) this.activeSourceScans.delete(exclusiveSourceId);
        else this.activeLibraryScans.delete(libraryId);
      });

      // Launch scan execution asynchronously in background.
      this.executeScanAsync(userId, libraryId, scan.id, targets, signal, exclusiveSourceId).catch(
        () => {},
      );
      return scan.id;
    } catch (error) {
      if (exclusiveSourceId) this.activeSourceScans.delete(exclusiveSourceId);
      else this.activeLibraryScans.delete(libraryId);
      throw error;
    }
  }

  private async executeScanAsync(
    userId: string,
    libraryId: string,
    scanId: string,
    targets: DriveScanTarget[],
    signal: AbortSignal,
    exclusiveSourceId?: string,
  ): Promise<void> {
    const startTime = Date.now();
    let addedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    try {
      await this.scanLifecycle.heartbeat(scanId, true);
      for (const target of targets) {
        signal.throwIfAborted();
        await this.scanLifecycle.heartbeat(scanId);
        const targetStartedAt = Date.now();
        let accessToken: string;
        try {
          accessToken = await this.googleOAuthService.getValidAccessToken(
            userId,
            target.connection.id,
          );
        } catch (tokenError) {
          if (signal.aborted) throw tokenError;
          errorCount++;
          const message =
            tokenError instanceof Error ? tokenError.message : 'GOOGLE_ACCOUNT_NOT_CONNECTED';
          await this.prisma.libraryScanError.create({
            data: { scanId, errorMessage: `Google hesabına erişilemedi: ${message}` },
          });
          if (target.sourceId) {
            await this.prisma.driveScanSource.update({
              where: { id: target.sourceId },
              data: {
                lastScanStatus: 'failed',
                lastScannedAt: new Date(),
                lastScanDurationMs: Date.now() - targetStartedAt,
                lastScanAddedCount: 0,
                lastScanUpdatedCount: 0,
                lastScanDeletedCount: 0,
                lastScanErrorCount: 1,
                lastScanError: message,
                lastScanInterruptionReason: null,
              },
            });
          }
          continue;
        }

        const result = await this.scanAccountFiles(
          userId,
          accessToken,
          target.connection.id,
          target.sourceId,
          libraryId,
          scanId,
          target.rootFolderId,
          signal,
        );
        signal.throwIfAborted();

        addedCount += result.added;
        updatedCount += result.updated;
        errorCount += result.errors;

        if (target.sourceId) {
          const latestError = result.errors
            ? await this.prisma.libraryScanError.findFirst({
                where: { scanId },
                orderBy: { createdAt: 'desc' },
                select: { errorMessage: true },
              })
            : null;
          await this.prisma.driveScanSource.updateMany({
            where: { id: target.sourceId, lastScanStatus: 'running' },
            data: {
              lastScanStatus: 'completed',
              lastScannedAt: new Date(),
              lastScanDurationMs: Date.now() - targetStartedAt,
              lastScanAddedCount: result.added,
              lastScanUpdatedCount: result.updated,
              lastScanDeletedCount: 0,
              lastScanErrorCount: result.errors,
              lastScanError: latestError?.errorMessage || null,
              lastScanInterruptionReason: null,
            },
          });
        }
      }

      const durationMs = Date.now() - startTime;

      signal.throwIfAborted();
      await this.prisma.libraryScan.updateMany({
        where: { id: scanId, status: 'running' },
        data: {
          status: 'completed',
          completedAt: new Date(),
          durationMs,
          addedCount,
          updatedCount,
          errorCount,
          heartbeatAt: new Date(),
          interruptionReason: null,
        },
      });

      await this.prisma.library.update({
        where: { id: libraryId },
        data: { lastScannedAt: new Date() },
      });
    } catch (err: unknown) {
      if (signal.aborted) return;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.prisma.libraryScan.updateMany({
        where: { id: scanId, status: 'running' },
        data: {
          status: 'failed',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorCount: errorCount + 1,
          heartbeatAt: new Date(),
          interruptionReason: null,
        },
      });

      await this.prisma.libraryScanError.create({
        data: {
          scanId,
          errorMessage: `Fatal scan error: ${errorMessage}`,
        },
      });
      const sourceIds = targets.flatMap((target) => (target.sourceId ? [target.sourceId] : []));
      if (sourceIds.length > 0) {
        await this.prisma.driveScanSource.updateMany({
          where: { id: { in: sourceIds }, lastScanStatus: 'running' },
          data: {
            lastScanStatus: 'failed',
            lastScannedAt: new Date(),
            lastScanError: errorMessage,
            lastScanInterruptionReason: null,
          },
        });
      }
    } finally {
      this.scanLifecycle.finish(scanId);
      if (exclusiveSourceId) this.activeSourceScans.delete(exclusiveSourceId);
      else this.activeLibraryScans.delete(libraryId);
    }
  }

  private async scanAccountFiles(
    userId: string,
    accessToken: string,
    googleConnectionId: string,
    driveScanSourceId: string | null,
    libraryId: string,
    scanId: string,
    rootFolderId: string,
    signal: AbortSignal,
  ): Promise<{ added: number; updated: number; errors: number }> {
    let added = 0;
    let updated = 0;
    let errors = 0;

    // An empty root folder scans the whole account. Otherwise only the selected
    // folder and its descendants are included.
    const allFiles: DriveFileMetadata[] = [];
    const tmdbApiKey = (
      await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tmdbApiKey: true },
      })
    )?.tmdbApiKey;

    try {
      if (rootFolderId.trim()) {
        allFiles.push(
          ...(await this.listFolderTree(accessToken, rootFolderId.trim(), scanId, signal)),
        );
      } else {
        let pageToken: string | undefined;
        do {
          signal.throwIfAborted();
          const page = await this.driveService.listAccountFiles(accessToken, pageToken, signal);
          allFiles.push(...page.files);
          pageToken = page.nextPageToken;
          await this.scanLifecycle.heartbeat(scanId);
        } while (pageToken);
      }
    } catch (err: unknown) {
      if (signal.aborted) throw err;
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
    const videos = allFiles.filter((file) => isDriveVideoFile(file.name, file.mimeType));
    const audioFiles = allFiles.filter(
      (file) =>
        !isPlaylistFilename(file.name, file.mimeType) &&
        (file.mimeType.startsWith('audio/') || isAudioFilename(file.name)),
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
        signal.throwIfAborted();
        await this.scanLifecycle.heartbeat(scanId);
        const driveFile = await this.upsertDriveFile(
          libraryId,
          googleConnectionId,
          driveScanSourceId,
          video,
        );
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
        if (driveScanSourceId) {
          await this.prisma.driveScanSource
            .update({
              where: { id: driveScanSourceId },
              data: {
                lastScanAddedCount: added,
                lastScanUpdatedCount: updated,
                lastScanErrorCount: errors,
              },
            })
            .catch(() => {});
        }

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
          ? await this.metadataService.fetchMetadata(
              title,
              type as 'movie' | 'series',
              tmdbApiKey || undefined,
            )
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
          await this.matchSubtitles(
            libraryId,
            googleConnectionId,
            driveScanSourceId,
            allFiles,
            video.name,
            {
              mediaItemId: mediaItem.id,
            },
          );
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
          await this.matchSubtitles(
            libraryId,
            googleConnectionId,
            driveScanSourceId,
            allFiles,
            video.name,
            {
              episodeId: episode.id,
            },
          );
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
        signal.throwIfAborted();
        await this.scanLifecycle.heartbeat(scanId);
        const driveFile = await this.upsertDriveFile(
          libraryId,
          googleConnectionId,
          driveScanSourceId,
          audio,
        );
        if (driveFile.isNew) added++;
        else if (driveFile.sourceChanged) updated++;
        if (!audio.size) throw new Error('AUDIO_SIZE_MISSING');
        const parsed = await this.musicLibraryService.metadata.parseRemoteFile({
          name: audio.name,
          size: BigInt(audio.size),
          readRange: (start, end) =>
            this.driveService.getMediaRangeBuffer(accessToken, audio.id, start, end, signal),
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
              content: await this.driveService.getFileTextContent(
                accessToken,
                matchingLyrics.id,
                signal,
              ),
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
        if (driveScanSourceId) {
          await this.prisma.driveScanSource
            .update({
              where: { id: driveScanSourceId },
              data: {
                lastScanAddedCount: added,
                lastScanUpdatedCount: updated,
                lastScanErrorCount: errors,
              },
            })
            .catch(() => {});
        }
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
        signal.throwIfAborted();
        await this.scanLifecycle.heartbeat(scanId);
        const technicalMetadata = await this.mediaProbeService.probeRemoteFile({
          name: probe.name,
          size: BigInt(probe.size),
          readRange: (start, end) =>
            this.driveService.getMediaRangeBuffer(accessToken, probe.fileId, start, end, signal),
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
    signal.throwIfAborted();

    return { added, updated, errors };
  }

  private async listFolderTree(
    accessToken: string,
    rootFolderId: string,
    scanId: string,
    signal: AbortSignal,
  ): Promise<DriveFileMetadata[]> {
    const files: DriveFileMetadata[] = [];
    const pendingFolderIds = [rootFolderId];
    const visitedFolderIds = new Set<string>();

    while (pendingFolderIds.length > 0) {
      signal.throwIfAborted();
      const folderId = pendingFolderIds.shift()!;
      if (visitedFolderIds.has(folderId)) continue;
      visitedFolderIds.add(folderId);

      let pageToken: string | undefined;
      do {
        const page = await this.driveService.listFolderContents(
          accessToken,
          folderId,
          pageToken,
          signal,
        );

        for (const file of page.files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            pendingFolderIds.push(file.id);
          } else {
            files.push(file);
          }
        }
        pageToken = page.nextPageToken;
        await this.scanLifecycle.heartbeat(scanId);
      } while (pageToken);
    }

    return files;
  }

  private async upsertDriveFile(
    libraryId: string,
    googleConnectionId: string,
    driveScanSourceId: string | null,
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
        driveScanSourceId,
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
        driveScanSourceId,
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
    driveScanSourceId: string | null,
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
      const driveFile = await this.upsertDriveFile(
        libraryId,
        googleConnectionId,
        driveScanSourceId,
        sub,
      );
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
}

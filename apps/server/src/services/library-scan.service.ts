import type { PrismaClient } from '@cinedrive/prisma';
import { randomUUID } from 'node:crypto';
import {
  normalizeSubtitleStem,
  parseMediaFilename,
  parseSubtitleFilename,
} from '@cinedrive/shared';
import { GoogleDriveService, type DriveFileMetadata } from './drive.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import {
  MetadataEnrichmentService,
  type MetadataEnrichmentTarget,
} from './metadata-enrichment.service.js';
import { MediaProbeService } from './media-probe.service.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { MusicLibraryService } from './music-library.service.js';
import { isAudioFilename, isPlaylistFilename } from './music-metadata.service.js';
import { isScanInterruptedError, type ScanLifecycleService } from './scan-lifecycle.service.js';
import type {
  LibraryOperationLock,
  LibraryOperationLockService,
} from './library-operation-lock.service.js';
import { MusicLanguageEnrichmentService } from './music-language-enrichment.service.js';
import { isDriveVideoFile } from './media-file-types.js';
import { resolveMediaItemId, upsertMediaItemWithIdentity } from './media-item-id.service.js';
import { createOrUpdateDriveFileForLibrary } from './drive-file-identity.service.js';
import {
  MAX_SCAN_FILE_COUNT,
  MAX_SCAN_FOLDER_COUNT,
  SCAN_FILE_LIMIT_EXCEEDED,
  SCAN_FOLDER_LIMIT_EXCEEDED,
} from './scan-limits.js';

// Each probe issues a handful of ranged Drive reads. Enough of them run at once
// to hide the latency, few enough to stay well inside Google's per-user quota.
const MEDIA_PROBE_CONCURRENCY = 4;

interface DriveScanTarget {
  connection: { id: string };
  rootFolderId: string;
  sourceId: string | null;
  changesPageToken?: string;
}

const isExpiredDriveChangeToken = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: {
      status?: unknown;
      data?: {
        error?: {
          message?: unknown;
          errors?: Array<{ reason?: unknown }>;
        };
      };
    };
    errors?: Array<{ reason?: unknown }>;
  };
  const status = Number(candidate.status ?? candidate.code ?? candidate.response?.status);
  const reasons = [
    ...(candidate.errors || []),
    ...(candidate.response?.data?.error?.errors || []),
  ].map((item) => String(item.reason || '').toLowerCase());
  if (status === 410 || reasons.some((reason) => reason.includes('pagetokenexpired'))) return true;
  if (status !== 400) return false;

  const message = [candidate.message, candidate.response?.data?.error?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return /page\s*token.*(invalid|expired|no longer valid)|(invalid|expired).*page\s*token/.test(
    message,
  );
};

export class LibraryScanService {
  private driveService = new GoogleDriveService();
  private mediaProbeService = new MediaProbeService();
  private musicLibraryService: MusicLibraryService;
  private activeLibraryScans = new Set<string>();
  private activeSourceScans = new Map<string, string>();

  constructor(
    private prisma: PrismaClient,
    private googleOAuthService: GoogleOAuthService,
    private scanLifecycle: ScanLifecycleService,
    private operationLocks: LibraryOperationLockService,
    private metadataEnrichment: MetadataEnrichmentService,
  ) {
    this.musicLibraryService = new MusicLibraryService(prisma);
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

  /** Scheduled scans skip the expensive inventory walk when Drive has no changes. */
  public async scanSourceIfChanged(
    userId: string,
    libraryId: string,
    sourceId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    const source = await this.prisma.driveScanSource.findFirst({
      where: { id: sourceId, libraryId, googleConnection: { userId } },
    });
    if (!source) throw new Error('DRIVE_SOURCE_NOT_FOUND');
    // Account-wide scans include shared drives, which need separate change
    // cursors. Keep these on the safe full-scan path until each drive has its
    // own persisted source cursor.
    if (!source.rootFolderId.trim()) {
      signal?.throwIfAborted();
      return this.scanSource(userId, libraryId, sourceId);
    }
    if (this.activeLibraryScans.has(libraryId) || this.activeSourceScans.has(sourceId)) {
      throw new Error('SCAN_ALREADY_IN_PROGRESS');
    }

    const connection = (await this.googleOAuthService.getConnectionsInfo(userId)).find(
      (item) => item.id === source.googleConnectionId,
    );
    if (!connection) throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    const accessToken = await this.googleOAuthService.getValidAccessToken(userId, connection.id);
    signal?.throwIfAborted();

    let driveId = source.driveId || undefined;
    if (!driveId && source.rootFolderId) {
      driveId = (
        await this.driveService.inspectFolder(accessToken, source.rootFolderId, false, signal)
      ).driveId;
      if (driveId) {
        await this.prisma.driveScanSource.updateMany({
          where: { id: source.id, driveId: null },
          data: { driveId },
        });
      }
    }

    let changesPageToken = source.changesPageToken || undefined;
    if (changesPageToken) {
      try {
        const changes = await this.driveService.getChangesSince(
          accessToken,
          changesPageToken,
          driveId,
          signal,
        );
        if (!changes.hasChanges) {
          signal?.throwIfAborted();
          return this.completeUnchangedSourceScan(
            libraryId,
            source.id,
            source.changesPageToken!,
            changes.pageToken,
          );
        }
        changesPageToken = changes.pageToken;
      } catch (error) {
        if (!isExpiredDriveChangeToken(error)) throw error;
        // Google can expire a cursor. Take a fresh snapshot and reconcile the
        // whole source; changes made during that reconciliation replay later.
        changesPageToken = await this.driveService.getChangesStartPageToken(
          accessToken,
          driveId,
          signal,
        );
      }
    } else {
      // Capture the cursor before inventory starts; later changes are picked
      // up by the next run instead of being accidentally skipped.
      changesPageToken = await this.driveService.getChangesStartPageToken(
        accessToken,
        driveId,
        signal,
      );
    }

    signal?.throwIfAborted();
    return this.startScan(
      userId,
      libraryId,
      [
        {
          connection,
          rootFolderId: source.rootFolderId,
          sourceId: source.id,
          changesPageToken,
        },
      ],
      source.id,
    );
  }

  private async completeUnchangedSourceScan(
    libraryId: string,
    sourceId: string,
    expectedPageToken: string,
    latestPageToken: string,
  ): Promise<string> {
    const operationLock = await this.operationLocks.acquire(libraryId, 'scan');
    try {
      const currentSource = await this.prisma.driveScanSource.findFirst({
        where: { id: sourceId, libraryId },
        select: { changesPageToken: true },
      });
      if (currentSource?.changesPageToken !== expectedPageToken) {
        throw new Error('SCAN_ALREADY_IN_PROGRESS');
      }

      const now = new Date();
      const scanId = randomUUID();
      await this.prisma.$transaction(async (tx) => {
        const sourceUpdate = await tx.driveScanSource.updateMany({
          where: { id: sourceId, changesPageToken: expectedPageToken },
          data: {
            changesPageToken: latestPageToken,
            lastScanStatus: 'completed',
            lastScannedAt: now,
            lastScanDurationMs: 0,
            lastScanAddedCount: 0,
            lastScanUpdatedCount: 0,
            lastScanDeletedCount: 0,
            lastScanErrorCount: 0,
            lastScanError: null,
            lastScanInterruptionReason: null,
          },
        });
        if (sourceUpdate.count !== 1) throw new Error('SCAN_ALREADY_IN_PROGRESS');
        await tx.libraryScan.create({
          data: {
            id: scanId,
            libraryId,
            driveScanSourceId: sourceId,
            status: 'completed',
            startedAt: now,
            completedAt: now,
            heartbeatAt: now,
            durationMs: 0,
          },
        });
        await tx.library.update({ where: { id: libraryId }, data: { lastScannedAt: now } });
      });
      return scanId;
    } finally {
      await operationLock.release();
    }
  }

  private async startScan(
    userId: string,
    libraryId: string,
    targets: DriveScanTarget[],
    exclusiveSourceId?: string,
  ): Promise<string> {
    const operationLock = await this.operationLocks.acquire(libraryId, 'scan');
    let handedOff = false;

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
      await operationLock.release();
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
      const signal = this.scanLifecycle.register(
        scan.id,
        libraryId,
        sourceIds,
        () => {
          if (exclusiveSourceId) this.activeSourceScans.delete(exclusiveSourceId);
          else this.activeLibraryScans.delete(libraryId);
        },
        () => operationLock.heartbeat(),
      );

      // Launch scan execution asynchronously in background.
      this.executeScanAsync(
        userId,
        libraryId,
        scan.id,
        targets,
        signal,
        operationLock,
        exclusiveSourceId,
      ).catch(() => {});
      handedOff = true;
      return scan.id;
    } catch (error) {
      if (exclusiveSourceId) this.activeSourceScans.delete(exclusiveSourceId);
      else this.activeLibraryScans.delete(libraryId);
      if (!handedOff) await operationLock.release();
      throw error;
    }
  }

  private async executeScanAsync(
    userId: string,
    libraryId: string,
    scanId: string,
    targets: DriveScanTarget[],
    signal: AbortSignal,
    operationLock: LibraryOperationLock,
    exclusiveSourceId?: string,
  ): Promise<void> {
    const startTime = Date.now();
    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let errorCount = 0;

    try {
      await this.scanLifecycle.heartbeat(scanId, true);
      for (const target of targets) {
        signal.throwIfAborted();
        await this.scanLifecycle.heartbeat(scanId);
        const targetStartedAt = Date.now();
        try {
          await this.googleOAuthService.getValidAccessToken(userId, target.connection.id);
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
        deletedCount += result.deleted;

        if (target.sourceId) {
          await this.scanLifecycle.heartbeat(scanId, true);
          signal.throwIfAborted();
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
              lastScanDeletedCount: result.deleted,
              lastScanErrorCount: result.errors,
              lastScanError: latestError?.errorMessage || null,
              lastScanInterruptionReason: null,
              ...(target.changesPageToken && result.errors === 0
                ? { changesPageToken: target.changesPageToken }
                : {}),
            },
          });
        }
      }

      const durationMs = Date.now() - startTime;

      await this.scanLifecycle.heartbeat(scanId, true);
      signal.throwIfAborted();
      await this.prisma.libraryScan.updateMany({
        where: { id: scanId, status: 'running' },
        data: {
          status: 'completed',
          completedAt: new Date(),
          durationMs,
          addedCount,
          updatedCount,
          deletedCount,
          errorCount,
          heartbeatAt: new Date(),
          interruptionReason: null,
        },
      });

      await this.prisma.library.update({
        where: { id: libraryId },
        data: { lastScannedAt: new Date() },
      });
      void new MusicLanguageEnrichmentService(this.prisma)
        .enrichLibrary(libraryId)
        .catch(() => undefined);
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
      await operationLock.release();
    }
  }

  private async scanAccountFiles(
    userId: string,
    googleConnectionId: string,
    driveScanSourceId: string | null,
    libraryId: string,
    scanId: string,
    rootFolderId: string,
    signal: AbortSignal,
  ): Promise<{ added: number; updated: number; deleted: number; errors: number }> {
    let added = 0;
    let updated = 0;
    let errors = 0;
    let deleted = 0;

    // An empty root folder scans the whole account. Otherwise only the selected
    // folder and its descendants are included.
    const allFiles: DriveFileMetadata[] = [];
    const appendFiles = (files: DriveFileMetadata[]) => {
      if (allFiles.length + files.length > MAX_SCAN_FILE_COUNT) {
        throw new Error(SCAN_FILE_LIMIT_EXCEEDED);
      }
      allFiles.push(...files);
    };
    try {
      if (rootFolderId.trim()) {
        appendFiles(
          await this.listFolderTree(
            userId,
            googleConnectionId,
            rootFolderId.trim(),
            scanId,
            signal,
          ),
        );
      } else {
        let pageToken: string | undefined;
        do {
          signal.throwIfAborted();
          const page = await this.googleOAuthService.withValidAccessToken(
            userId,
            googleConnectionId,
            (accessToken) => this.driveService.listAccountFiles(accessToken, pageToken, signal),
          );
          appendFiles(page.files);
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
      return { added, updated, deleted, errors };
    }

    // 2. Separate into videos, images, subtitles, metadata
    const videos = allFiles.filter((file) => isDriveVideoFile(file.name, file.mimeType));
    const audioFiles = allFiles.filter(
      (file) =>
        !isPlaylistFilename(file.name, file.mimeType) &&
        (file.mimeType.startsWith('audio/') || isAudioFilename(file.name)),
    );
    const lyricsFiles = allFiles.filter((file) => file.name.toLowerCase().endsWith('.lrc'));
    const subtitlesByStem = new Map<string, DriveFileMetadata[]>();
    for (const file of allFiles) {
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith('.vtt') && !lowerName.endsWith('.srt')) continue;
      const stem = normalizeSubtitleStem(file.name);
      const candidates = subtitlesByStem.get(stem) || [];
      candidates.push(file);
      subtitlesByStem.set(stem, candidates);
    }
    const lyricsByParentAndPrefix = new Map<string, DriveFileMetadata[]>();
    for (const lyric of lyricsFiles) {
      const parent = lyric.parents?.[0] || '';
      const base = lyric.name.replace(/\.lrc$/i, '').toLowerCase();
      const prefixEnds = new Set<number>([base.length]);
      for (let dot = base.indexOf('.'); dot >= 0; dot = base.indexOf('.', dot + 1)) {
        prefixEnds.add(dot);
      }
      for (const end of prefixEnds) {
        const key = `${parent}\u0000${base.slice(0, end)}`;
        const candidates = lyricsByParentAndPrefix.get(key) || [];
        candidates.push(lyric);
        lyricsByParentAndPrefix.set(key, candidates);
      }
    }

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
    const pendingMetadata = new Map<string, MetadataEnrichmentTarget>();
    const queueMetadata = (target: MetadataEnrichmentTarget) => {
      const existing = pendingMetadata.get(target.mediaItemId);
      pendingMetadata.set(target.mediaItemId, {
        ...target,
        year: target.year ?? existing?.year,
        refreshMedia: target.refreshMedia || existing?.refreshMedia || false,
        refreshEpisodes: target.refreshEpisodes || existing?.refreshEpisodes || false,
      });
    };

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
        const mediaItemId = await resolveMediaItemId(
          this.prisma,
          type,
          normalizedTitle,
          libraryId,
          {
            year,
            driveFileId: driveFile.record.id,
            seasonNumber: parsedName.seasonNumber,
            episodeNumber: parsedName.episodeNumber,
          },
        );
        const existingMediaItem = await this.prisma.mediaItem.findUnique({
          where: { id: mediaItemId },
        });

        const durationSec = video.videoMediaMetadata?.durationMillis
          ? parseFloat(String(video.videoMediaMetadata.durationMillis)) / 1000
          : undefined;

        const onlinePosterUrl: string | null = existingMediaItem?.posterUrl || null;
        const onlineBackdropUrl: string | null = existingMediaItem?.backdropUrl || null;
        const overview: string | null = existingMediaItem?.overview || null;
        const finalYear = year ?? existingMediaItem?.year ?? undefined;
        const voteAverage = existingMediaItem?.voteAverage ?? undefined;
        const voteCount = existingMediaItem?.voteCount ?? undefined;
        const genresStr = existingMediaItem?.genres ?? undefined;
        const castStr = existingMediaItem?.cast ?? undefined;
        const trailerUrl = existingMediaItem?.trailerUrl ?? undefined;
        const contentRating = existingMediaItem?.contentRating ?? undefined;
        const tmdbId = existingMediaItem?.tmdbId ?? undefined;
        const imdbId = existingMediaItem?.imdbId ?? undefined;

        const shouldRefreshMetadata =
          driveFile.isNew ||
          driveFile.sourceChanged ||
          !existingMediaItem ||
          !existingMediaItem.tmdbId;
        // Create-first plus retry prevents a simultaneous scan of another
        // library from being re-homed through an upsert update branch.
        const mediaItem = await upsertMediaItemWithIdentity(
          this.prisma,
          mediaItemId,
          type,
          normalizedTitle,
          libraryId,
          {
            year,
            driveFileId: driveFile.record.id,
            seasonNumber: parsedName.seasonNumber,
            episodeNumber: parsedName.episodeNumber,
          },
          {
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
          {
            // A rescan updates metadata without changing the library owner.
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
        );

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
            subtitlesByStem,
            video,
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
          const shouldRefreshEpisodeMetadata =
            driveFile.isNew ||
            driveFile.sourceChanged ||
            !existingEpisode ||
            !existingEpisode.stillUrl;

          const epTitle = existingEpisode?.title || video.name.replace(/\.[^/.]+$/, '');
          const epOverview = existingEpisode?.overview || null;
          const epStillUrl = existingEpisode?.stillUrl || null;

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
            subtitlesByStem,
            video,
            {
              episodeId: episode.id,
            },
          );
          queueMetadata({
            libraryId,
            mediaItemId: mediaItem.id,
            title,
            type: 'series',
            year: year ?? existingMediaItem?.year ?? undefined,
            refreshMedia: shouldRefreshMetadata,
            seriesId: series.id,
            refreshEpisodes: shouldRefreshEpisodeMetadata,
          });
        }
        if (type === 'movie') {
          queueMetadata({
            libraryId,
            mediaItemId: mediaItem.id,
            title,
            type: 'movie',
            year: year ?? existingMediaItem?.year ?? undefined,
            refreshMedia: shouldRefreshMetadata,
          });
        }
      } catch (err: unknown) {
        if (signal.aborted || isScanInterruptedError(err)) throw err;
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
            this.googleOAuthService.withValidAccessToken(
              userId,
              googleConnectionId,
              (accessToken) =>
                this.driveService.getMediaRangeBuffer(accessToken, audio.id, start, end, signal),
            ),
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
        const matchingLyrics = (
          lyricsByParentAndPrefix.get(`${audioParent || ''}\u0000${audioBase}`) || []
        ).sort((left, right) => {
          const leftExact = left.name.replace(/\.lrc$/i, '').toLowerCase() === audioBase ? 0 : 1;
          const rightExact = right.name.replace(/\.lrc$/i, '').toLowerCase() === audioBase ? 0 : 1;
          return leftExact - rightExact || left.name.localeCompare(right.name);
        })[0];
        try {
          if (matchingLyrics) {
            await this.musicLibraryService.lyrics.syncTrackLyrics({
              trackId: track.id,
              sourceName: matchingLyrics.name,
              content: await this.googleOAuthService.withValidAccessToken(
                userId,
                googleConnectionId,
                (accessToken) =>
                  this.driveService.getFileTextContent(accessToken, matchingLyrics.id, signal),
              ),
            });
          } else {
            await this.musicLibraryService.lyrics.removeSidecarLyrics(track.id);
          }
        } catch (lyricsError) {
          if (signal.aborted || isScanInterruptedError(lyricsError)) throw lyricsError;
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
        if (signal.aborted || isScanInterruptedError(error)) throw error;
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

    await runWithConcurrency(
      pendingProbes,
      MEDIA_PROBE_CONCURRENCY,
      async (probe) => {
        try {
          signal.throwIfAborted();
          await this.scanLifecycle.heartbeat(scanId);
          const technicalMetadata = await this.mediaProbeService.probeRemoteFile({
            name: probe.name,
            size: BigInt(probe.size),
            readRange: (start, end) =>
              this.googleOAuthService.withValidAccessToken(
                userId,
                googleConnectionId,
                (accessToken) =>
                  this.driveService.getMediaRangeBuffer(
                    accessToken,
                    probe.fileId,
                    start,
                    end,
                    signal,
                  ),
              ),
          });
          signal.throwIfAborted();
          await this.prisma.driveFile.update({
            where: { id: probe.driveFileId },
            data: technicalMetadata,
          });
        } catch (error) {
          if (signal.aborted || isScanInterruptedError(error)) throw error;
          // A file that cannot be probed still belongs in the library; the
          // failure is recorded on the row so Media Health can surface it.
          await this.prisma.driveFile
            .update({
              where: { id: probe.driveFileId },
              data: {
                mediaAnalyzedAt: new Date(),
                mediaAnalysisError:
                  error instanceof Error
                    ? error.message.slice(0, 500)
                    : 'REMOTE_MEDIA_PROBE_FAILED',
              },
            })
            .catch(() => {});
        }
      },
      signal,
    );
    signal.throwIfAborted();

    const seenGoogleFileIds = new Set(allFiles.map((file) => file.id));
    signal.throwIfAborted();
    const existingFiles = await this.prisma.driveFile.findMany({
      where: {
        libraryId,
        storageType: 'gdrive',
        googleConnectionId,
        driveScanSourceId,
        status: 'active',
        googleDriveFileId: { not: null },
      },
      select: { id: true, googleDriveFileId: true },
    });
    const missingFileIds = existingFiles
      .filter((file) => !!file.googleDriveFileId && !seenGoogleFileIds.has(file.googleDriveFileId))
      .map((file) => file.id);
    if (missingFileIds.length > 0) {
      signal.throwIfAborted();
      await this.scanLifecycle.heartbeat(scanId, true);
      signal.throwIfAborted();
      const result = await this.prisma.driveFile.updateMany({
        where: { id: { in: missingFileIds }, status: 'active' },
        data: { status: 'missing' },
      });
      signal.throwIfAborted();
      deleted = result.count;
    }

    await this.metadataEnrichment.enqueueAfterIndexing([...pendingMetadata.values()]);

    return { added, updated, deleted, errors };
  }

  private async listFolderTree(
    userId: string,
    googleConnectionId: string,
    rootFolderId: string,
    scanId: string,
    signal: AbortSignal,
  ): Promise<DriveFileMetadata[]> {
    const files: DriveFileMetadata[] = [];
    const pendingFolderIds = [rootFolderId];
    let nextPendingFolderIndex = 0;
    const visitedFolderIds = new Set<string>();
    const discoveredFolderIds = new Set<string>([rootFolderId]);

    while (nextPendingFolderIndex < pendingFolderIds.length) {
      signal.throwIfAborted();
      const folderId = pendingFolderIds[nextPendingFolderIndex++]!;
      if (visitedFolderIds.has(folderId)) continue;
      visitedFolderIds.add(folderId);

      let pageToken: string | undefined;
      do {
        const page = await this.googleOAuthService.withValidAccessToken(
          userId,
          googleConnectionId,
          (accessToken) =>
            this.driveService.listFolderContents(accessToken, folderId, pageToken, signal),
        );

        for (const file of page.files) {
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            if (!discoveredFolderIds.has(file.id)) {
              if (discoveredFolderIds.size >= MAX_SCAN_FOLDER_COUNT) {
                throw new Error(SCAN_FOLDER_LIMIT_EXCEEDED);
              }
              discoveredFolderIds.add(file.id);
              pendingFolderIds.push(file.id);
            }
          } else {
            if (files.length >= MAX_SCAN_FILE_COUNT) {
              throw new Error(SCAN_FILE_LIMIT_EXCEEDED);
            }
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
    if (existing && existing.libraryId !== libraryId) {
      throw new Error('DRIVE_FILE_LIBRARY_CONFLICT');
    }
    const nextModifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;
    const sourceChanged =
      !!existing &&
      (existing.size !== (file.size ? BigInt(file.size) : null) ||
        existing.modifiedTime?.getTime() !== nextModifiedTime?.getTime() ||
        existing.md5Checksum !== (file.md5Checksum || null));

    const result = await createOrUpdateDriveFileForLibrary(
      this.prisma,
      { googleDriveFileId: file.id },
      libraryId,
      {
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
      {
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
    );
    const record = result.record;

    return {
      record,
      isNew: result.created,
      sourceChanged,
      needsMediaAnalysis: !existing?.mediaAnalyzedAt || sourceChanged,
    };
  }

  private async matchSubtitles(
    libraryId: string,
    googleConnectionId: string,
    driveScanSourceId: string | null,
    subtitlesByStem: ReadonlyMap<string, DriveFileMetadata[]>,
    video: DriveFileMetadata,
    target: { mediaItemId?: string; episodeId?: string },
  ) {
    const videoBase = normalizeSubtitleStem(video.name);
    const subtitles = (subtitlesByStem.get(videoBase) || []).filter(
      (f) =>
        !video.parents?.length ||
        !f.parents?.length ||
        f.parents.some((parent) => video.parents?.includes(parent)),
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

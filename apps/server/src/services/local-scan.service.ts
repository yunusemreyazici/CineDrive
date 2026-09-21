import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@cinedrive/prisma';
import { parseMediaFilename } from '@cinedrive/shared';
import { MetadataService } from './metadata.service.js';
import { MediaProbeService } from './media-probe.service.js';
import { MusicLibraryService } from './music-library.service.js';
import { isAudioFilename } from './music-metadata.service.js';
import type { ScanLifecycleService } from './scan-lifecycle.service.js';
import { MusicLanguageEnrichmentService } from './music-language-enrichment.service.js';
import { isVideoFilename } from './media-file-types.js';
import { isPathWithinRoot, resolveLocalFolder } from './local-folder-validation.js';
import { resolveMediaItemId } from './media-item-id.service.js';
import {
  MAX_SCAN_FILE_COUNT,
  MAX_SCAN_FOLDER_COUNT,
  SCAN_FILE_LIMIT_EXCEEDED,
  SCAN_FOLDER_LIMIT_EXCEEDED,
} from './scan-limits.js';

export class LocalScanService {
  private metadataService = new MetadataService();
  private mediaProbeService = new MediaProbeService();
  private musicLibraryService: MusicLibraryService;
  private readonly activeScans = new Set<string>();

  constructor(
    private prisma: PrismaClient,
    private scanLifecycle: ScanLifecycleService,
  ) {
    this.musicLibraryService = new MusicLibraryService(prisma);
  }

  /**
   * Validates the library, records a running scan and hands the work off to the
   * background, returning the scan id immediately.
   *
   * The route used to await the whole scan, holding the HTTP request open for
   * as long as indexing took — which is why the client needed a two-minute
   * timeout. The `LibraryScan` record it creates is what the UI polls, so the
   * progress reporting already worked; only the response was blocking.
   */
  public async startLocalScan(libraryId: string): Promise<string> {
    if (this.activeScans.has(libraryId)) {
      throw new Error('SCAN_ALREADY_IN_PROGRESS');
    }

    const library = await this.prisma.library.findUnique({
      where: { id: libraryId },
    });

    if (!library || library.storageType !== 'local' || !library.localFolderPath) {
      throw new Error('Yerel kütüphane bulunamadı veya geçerli bir yerel klasör yolu yok.');
    }

    let resolvedFolder: string;
    try {
      // Re-resolve on every scan. A directory can be replaced with a symlink
      // after creation, so trusting the stored path would re-open traversal.
      resolvedFolder = await resolveLocalFolder(library.localFolderPath);
    } catch {
      throw new Error('LOCAL_FOLDER_UNAVAILABLE');
    }

    this.activeScans.add(libraryId);

    const scan = await this.prisma.libraryScan.create({
      data: {
        libraryId,
        status: 'running',
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    const signal = this.scanLifecycle.register(scan.id, libraryId, [], () => {
      this.activeScans.delete(libraryId);
    });

    void this.executeLocalScan(libraryId, library.userId, resolvedFolder, scan.id, signal)
      .catch(() => {
        // Failures are already recorded on the scan row for the UI to read.
      })
      .finally(() => {
        this.scanLifecycle.finish(scan.id);
        this.activeScans.delete(libraryId);
      });

    return scan.id;
  }

  /**
   * Scans a local filesystem folder recursively and indexes movies, TV shows, and subtitles.
   * Enriches MediaItems with TMDB metadata (poster, backdrop, overview, cast, etc.)
   */
  private async executeLocalScan(
    libraryId: string,
    userId: string,
    localFolderPath: string,
    scanId: string,
    signal: AbortSignal,
  ): Promise<{ success: boolean; filesScanned: number }> {
    const library = { localFolderPath };
    const scan = { id: scanId };
    const startedAt = Date.now();

    let filesScannedCount = 0;
    let addedCount = 0;
    let updatedCount = 0;

    try {
      await this.scanLifecycle.heartbeat(scanId, true);
      const tmdbApiKey = (
        await this.prisma.user.findUnique({
          where: { id: userId },
          select: { tmdbApiKey: true },
        })
      )?.tmdbApiKey;
      const allFiles = await this.readdirRecursive(
        library.localFolderPath,
        library.localFolderPath,
        scanId,
        signal,
      );

      const subtitleExtensions = ['.srt', '.vtt'];

      const videoFiles = allFiles.filter((file) => isVideoFilename(file.name));
      const subtitleFiles = allFiles.filter((f) =>
        subtitleExtensions.some((ext) => f.name.toLowerCase().endsWith(ext)),
      );
      const audioFiles = allFiles.filter((file) => isAudioFilename(file.name));
      const lyricsFiles = allFiles.filter((file) => file.name.toLowerCase().endsWith('.lrc'));

      // Process each video file
      for (const file of videoFiles) {
        try {
          signal.throwIfAborted();
          await this.scanLifecycle.heartbeat(scanId);
          filesScannedCount++;
          const stat = await fs.stat(file.fullPath);
          const mimeType = this.getMimeType(file.name);

          const existingDriveFile = await this.prisma.driveFile.findUnique({
            where: { localFilePath: file.fullPath },
          });
          const sourceChanged =
            !existingDriveFile?.modifiedTime ||
            existingDriveFile.modifiedTime.getTime() !== stat.mtime.getTime();
          let technicalMetadata = {};
          if (!existingDriveFile?.mediaAnalyzedAt || sourceChanged) {
            try {
              technicalMetadata = await this.mediaProbeService.probeLocalFile(file.fullPath);
            } catch (probeError) {
              technicalMetadata = {
                mediaAnalyzedAt: new Date(),
                mediaAnalysisError:
                  probeError instanceof Error
                    ? probeError.message.slice(0, 500)
                    : 'MEDIA_PROBE_FAILED',
              };
              console.warn(
                `[LocalScan] Teknik medya analizi başarısız: ${file.fullPath}`,
                probeError,
              );
            }
          }

          if (existingDriveFile && sourceChanged) {
            updatedCount++;
          } else if (!existingDriveFile) {
            addedCount++;
          }

          const driveFile = await this.prisma.driveFile.upsert({
            where: { localFilePath: file.fullPath },
            update: {
              libraryId,
              name: file.name,
              size: BigInt(stat.size),
              modifiedTime: stat.mtime,
              mimeType,
              status: 'active',
              ...technicalMetadata,
            },
            create: {
              libraryId,
              storageType: 'local',
              localFilePath: file.fullPath,
              name: file.name,
              size: BigInt(stat.size),
              modifiedTime: stat.mtime,
              mimeType,
              status: 'active',
              ...technicalMetadata,
            },
          });

          // Use shared parseMediaFilename for better title parsing (same as GDrive scan)
          const parsedName = parseMediaFilename(file.name);
          const title = parsedName.title;
          const normalizedTitle = title.toLowerCase();
          const year = parsedName.year;
          const type = parsedName.type; // 'movie' | 'series'
          const seasonNumber = parsedName.seasonNumber || 1;
          const episodeNumber = parsedName.episodeNumber || 1;
          const mediaItemId = await resolveMediaItemId(this.prisma, type, normalizedTitle, libraryId);
          const existingMediaItem = await this.prisma.mediaItem.findUnique({
            where: { id: mediaItemId },
          });

          // ── TMDB Metadata Enrichment ─────────────────────────────────────────
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

          const onlineMeta =
            !existingDriveFile || sourceChanged || !existingMediaItem || !existingMediaItem.tmdbId
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
          // ────────────────────────────────────────────────────────────────────

          // Deterministic ID (same algorithm as LibraryScanService)
          // Upsert MediaItem with full TMDB data
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
              year: finalYear ?? undefined,
              overview: overview ?? undefined,
              posterUrl: onlinePosterUrl ?? undefined,
              backdropUrl: onlineBackdropUrl ?? undefined,
              voteAverage: voteAverage ?? undefined,
              voteCount: voteCount ?? undefined,
              genres: genresStr ?? undefined,
              cast: castStr ?? undefined,
              trailerUrl: trailerUrl ?? undefined,
              contentRating: contentRating ?? undefined,
              tmdbId: tmdbId ?? undefined,
              imdbId: imdbId ?? undefined,
            },
          });

          if (type === 'movie') {
            await this.prisma.movie.upsert({
              where: { mediaItemId: mediaItem.id },
              create: {
                mediaItemId: mediaItem.id,
                driveFileId: driveFile.id,
              },
              update: {
                driveFileId: driveFile.id,
              },
            });
          } else {
            // TV Series
            const series = await this.prisma.series.upsert({
              where: { mediaItemId: mediaItem.id },
              create: { mediaItemId: mediaItem.id },
              update: {},
            });

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

            // Fetch per-episode TMDB metadata
            const existingEpisode = await this.prisma.episode.findUnique({
              where: {
                seasonId_episodeNumber: {
                  seasonId: season.id,
                  episodeNumber,
                },
              },
            });
            const epMetaMap =
              !existingDriveFile || sourceChanged || !existingEpisode || !existingEpisode.stillUrl
                ? await this.metadataService.fetchShowEpisodes(title)
                : new Map();
            const epMeta = epMetaMap.get(`${seasonNumber}x${episodeNumber}`);
            const epTitle = epMeta?.name || file.name.replace(/\.[^/.]+$/, '');
            const epOverview = epMeta?.overview || null;
            const epStillUrl = epMeta?.stillUrl || null;

            await this.prisma.episode.upsert({
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
                driveFileId: driveFile.id,
                episodeNumber,
                seasonNumber,
                title: epTitle,
                overview: epOverview,
                stillUrl: epStillUrl,
              },
              update: {
                driveFileId: driveFile.id,
                title: epTitle,
                overview: epOverview ?? undefined,
                stillUrl: epStillUrl ?? undefined,
              },
            });
          }

          // Live progress update
          await this.prisma.libraryScan
            .update({
              where: { id: scan.id },
              data: {
                addedCount,
                updatedCount,
              },
            })
            .catch(() => {});
        } catch (fileErr: unknown) {
          // Log individual file errors but continue scanning
          console.error(`[LocalScan] Dosya işlenirken hata: ${file.fullPath}`, fileErr);
        }
      }

      for (const file of audioFiles) {
        try {
          signal.throwIfAborted();
          await this.scanLifecycle.heartbeat(scanId);
          filesScannedCount++;
          const stat = await fs.stat(file.fullPath);
          const existing = await this.prisma.driveFile.findUnique({
            where: { localFilePath: file.fullPath },
          });
          const sourceChanged =
            !existing?.modifiedTime || existing.modifiedTime.getTime() !== stat.mtime.getTime();
          const parsed = await this.musicLibraryService.metadata.parseLocalFile(
            file.fullPath,
            library.localFolderPath,
          );
          const driveFile = await this.prisma.driveFile.upsert({
            where: { localFilePath: file.fullPath },
            create: {
              libraryId,
              storageType: 'local',
              localFilePath: file.fullPath,
              name: file.name,
              mimeType: this.getMimeType(file.name),
              size: BigInt(stat.size),
              modifiedTime: stat.mtime,
              status: 'active',
              mediaContainer: parsed.container,
              audioCodec: parsed.codec,
              audioChannels: parsed.channels,
              audioSampleRate: parsed.sampleRate,
              audioBitrate: parsed.bitrate,
              audioBitDepth: parsed.bitDepth,
              audioLossless: parsed.lossless,
              mediaDuration: parsed.duration,
              mediaAnalyzedAt: new Date(),
            },
            update: {
              libraryId,
              name: file.name,
              mimeType: this.getMimeType(file.name),
              size: BigInt(stat.size),
              modifiedTime: stat.mtime,
              status: 'active',
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
            driveFileId: driveFile.id,
            metadata: parsed,
          });
          const audioBase = path.parse(file.name).name.toLowerCase();
          const matchingLyrics = lyricsFiles
            .filter((candidate) => {
              if (path.dirname(candidate.fullPath) !== path.dirname(file.fullPath)) return false;
              const lyricsBase = path.parse(candidate.name).name.toLowerCase();
              return lyricsBase === audioBase || lyricsBase.startsWith(`${audioBase}.`);
            })
            .sort((left, right) => {
              const leftExact = path.parse(left.name).name.toLowerCase() === audioBase ? 0 : 1;
              const rightExact = path.parse(right.name).name.toLowerCase() === audioBase ? 0 : 1;
              return leftExact - rightExact || left.name.localeCompare(right.name);
            })[0];
          try {
            if (matchingLyrics) {
              await this.musicLibraryService.lyrics.syncTrackLyrics({
                trackId: track.id,
                sourceName: matchingLyrics.name,
                content: await fs.readFile(matchingLyrics.fullPath, 'utf8'),
              });
            } else {
              await this.musicLibraryService.lyrics.removeSidecarLyrics(track.id);
            }
          } catch (lyricsError) {
            await this.prisma.libraryScanError.create({
              data: {
                scanId: scan.id,
                driveFileId: driveFile.id,
                errorMessage: `LRC dosyası işlenemedi (${matchingLyrics?.name || file.name}): ${lyricsError instanceof Error ? lyricsError.message : String(lyricsError)}`,
              },
            });
          }
          if (!existing) addedCount++;
          else if (sourceChanged) updatedCount++;
          await this.prisma.libraryScan
            .update({
              where: { id: scan.id },
              data: { addedCount, updatedCount },
            })
            .catch(() => {});
        } catch (error) {
          await this.prisma.libraryScanError.create({
            data: {
              scanId: scan.id,
              errorMessage: `Ses dosyası işlenemedi (${file.name}): ${error instanceof Error ? error.message : String(error)}`,
            },
          });
        }
      }

      // Process local subtitle files - each gets its own DriveFile entry
      for (const subFile of subtitleFiles) {
        try {
          signal.throwIfAborted();
          await this.scanLifecycle.heartbeat(scanId);
          const matchingVideo = videoFiles.find(
            (v) =>
              path.parse(v.name).name.toLowerCase() === path.parse(subFile.name).name.toLowerCase(),
          );

          if (matchingVideo) {
            const lang = this.detectSubtitleLanguage(subFile.name);

            // Upsert subtitle file as its own DriveFile
            const subDriveFile = await this.prisma.driveFile.upsert({
              where: { localFilePath: subFile.fullPath },
              update: {
                libraryId,
                storageType: 'local',
                name: subFile.name,
                mimeType: subFile.name.endsWith('.vtt') ? 'text/vtt' : 'application/x-subrip',
                status: 'active',
              },
              create: {
                libraryId,
                storageType: 'local',
                localFilePath: subFile.fullPath,
                name: subFile.name,
                mimeType: subFile.name.endsWith('.vtt') ? 'text/vtt' : 'application/x-subrip',
                status: 'active',
              },
            });

            // Upsert subtitle track linked to subtitle DriveFile
            await this.prisma.subtitleTrack.upsert({
              where: { driveFileId: subDriveFile.id },
              update: {
                language: lang,
                label: `Yerel (${lang.toUpperCase()})`,
              },
              create: {
                driveFileId: subDriveFile.id,
                language: lang,
                label: `Yerel (${lang.toUpperCase()})`,
                isDefault: lang === 'tr',
              },
            });
          }
        } catch (subErr: unknown) {
          console.error(`[LocalScan] Altyazı işlenirken hata: ${subFile.fullPath}`, subErr);
        }
      }

      const seenPaths = new Set(allFiles.map((file) => file.fullPath));
      const existingLocalFiles = await this.prisma.driveFile.findMany({
        where: {
          libraryId,
          storageType: 'local',
          status: 'active',
          localFilePath: { not: null },
        },
        select: { id: true, localFilePath: true },
      });
      const missingFileIds: string[] = [];
      for (const file of existingLocalFiles) {
        if (!file.localFilePath) continue;

        // Older rows may contain a symlink spelling such as /var/... while
        // the current scan root is /private/var/... on macOS. Resolve the
        // existing path when possible, and resolve its parent when the file
        // itself has disappeared, so reconciliation remains compatible with
        // those historical rows without trusting a symlink target outside the
        // configured root.
        let comparablePath = file.localFilePath;
        try {
          comparablePath = await fs.realpath(file.localFilePath);
        } catch {
          try {
            comparablePath = path.join(
              await fs.realpath(path.dirname(file.localFilePath)),
              path.basename(file.localFilePath),
            );
          } catch {
            comparablePath = path.resolve(file.localFilePath);
          }
        }

        if (
          isPathWithinRoot(library.localFolderPath, comparablePath) &&
          !seenPaths.has(comparablePath)
        ) {
          missingFileIds.push(file.id);
        }
      }
      if (missingFileIds.length > 0) {
        await this.prisma.driveFile.updateMany({
          where: { id: { in: missingFileIds }, status: 'active' },
          data: { status: 'missing' },
        });
      }

      // Mark scan completed only after reconciliation succeeds. An interrupted
      // or failed walk must never make unseen files look deleted.
      const errorCount = await this.prisma.libraryScanError.count({ where: { scanId: scan.id } });
      signal.throwIfAborted();
      await this.prisma.libraryScan.updateMany({
        where: { id: scan.id, status: 'running' },
        data: {
          status: 'completed',
          addedCount,
          updatedCount,
          deletedCount: missingFileIds.length,
          errorCount,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
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

      return { success: true, filesScanned: filesScannedCount };
    } catch (err: unknown) {
      if (signal.aborted) return { success: false, filesScanned: filesScannedCount };
      const errorMessage =
        err instanceof Error ? err.message : 'Yerel kütüphane taranırken hata oluştu.';

      await this.prisma.libraryScan.updateMany({
        where: { id: scan.id, status: 'running' },
        data: {
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorCount: { increment: 1 },
          completedAt: new Date(),
          heartbeatAt: new Date(),
          interruptionReason: null,
        },
      });
      await this.prisma.libraryScanError.create({ data: { scanId: scan.id, errorMessage } });

      throw err;
    }
  }

  private detectSubtitleLanguage(filename: string): string {
    const lower = filename.toLowerCase();
    if (
      lower.includes('.en.') ||
      lower.includes('_en.') ||
      lower.includes('.eng.') ||
      lower.endsWith('.en.srt') ||
      lower.endsWith('.en.vtt')
    )
      return 'en';
    if (lower.includes('.de.') || lower.includes('_de.') || lower.includes('.ger.')) return 'de';
    if (lower.includes('.fr.') || lower.includes('_fr.') || lower.includes('.fre.')) return 'fr';
    if (lower.includes('.es.') || lower.includes('_es.') || lower.includes('.spa.')) return 'es';
    if (lower.includes('.it.') || lower.includes('_it.') || lower.includes('.ita.')) return 'it';
    return 'tr'; // Default to Turkish
  }

  private async readdirRecursive(
    dir: string,
    root: string,
    scanId: string,
    signal: AbortSignal,
    visitedDirectories = new Set<string>(),
  ): Promise<Array<{ name: string; fullPath: string }>> {
    const results: Array<{ name: string; fullPath: string }> = [];

    if (visitedDirectories.has(dir)) return results;
    visitedDirectories.add(dir);
    if (visitedDirectories.size > MAX_SCAN_FOLDER_COUNT) {
      throw new Error(SCAN_FOLDER_LIMIT_EXCEEDED);
    }

    try {
      signal.throwIfAborted();
      await this.scanLifecycle.heartbeat(scanId);
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden dirs and common non-media dirs
          if (
            !entry.name.startsWith('.') &&
            entry.name !== 'node_modules' &&
            entry.name !== '__pycache__'
          ) {
            const canonicalDirectory = await fs.realpath(fullPath);
            if (isPathWithinRoot(root, canonicalDirectory)) {
              const subDirFiles = await this.readdirRecursive(
                canonicalDirectory,
                root,
                scanId,
                signal,
                visitedDirectories,
              );
              if (results.length + subDirFiles.length > MAX_SCAN_FILE_COUNT) {
                throw new Error(SCAN_FILE_LIMIT_EXCEEDED);
              }
              results.push(...subDirFiles);
            }
          }
        } else if (entry.isFile()) {
          if (!entry.name.startsWith('.')) {
            const canonicalFile = await fs.realpath(fullPath);
            if (isPathWithinRoot(root, canonicalFile)) {
              if (results.length >= MAX_SCAN_FILE_COUNT) {
                throw new Error(SCAN_FILE_LIMIT_EXCEEDED);
              }
              results.push({ name: entry.name, fullPath: canonicalFile });
            }
          }
        }
      }
    } catch (error) {
      // A partial walk cannot distinguish an unreadable directory from a
      // directory whose files were removed concurrently. Fail the scan so
      // reconciliation never marks unseen rows as missing on incomplete input.
      throw error;
    }

    return results;
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.mp4':
      case '.m4v':
        return 'video/mp4';
      case '.webm':
        return 'video/webm';
      case '.mkv':
        return 'video/x-matroska';
      case '.avi':
        return 'video/x-msvideo';
      case '.mov':
        return 'video/quicktime';
      case '.m2ts':
        return 'video/mp2t';
      case '.flv':
        return 'video/x-flv';
      case '.wmv':
        return 'video/x-ms-wmv';
      case '.3gp':
        return 'video/3gpp';
      case '.mp3':
        return 'audio/mpeg';
      case '.m4a':
      case '.aac':
        return 'audio/mp4';
      case '.flac':
        return 'audio/flac';
      case '.ogg':
      case '.opus':
        return 'audio/ogg';
      case '.wav':
        return 'audio/wav';
      case '.wma':
        return 'audio/x-ms-wma';
      default:
        return 'application/octet-stream';
    }
  }
}

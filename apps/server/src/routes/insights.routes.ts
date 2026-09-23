import type { FastifyPluginAsync } from 'fastify';
import { ownedLibraryFilter, ownedMediaFilter } from '../utils/library-access.js';
import type { MediaHealthDto } from '@cinedrive/shared';
import { buildPlaybackPlan, type PlaybackMode } from '../services/playback-plan.service.js';
import { MediaProbeService } from '../services/media-probe.service.js';
import { resolveSafeLocalFile } from '../services/local-folder-validation.js';

const INSIGHTS_PAGE_SIZE = 500;
const MEDIA_HEALTH_CACHE_TTL_MS = 60_000;

type MediaHealthInventory = Pick<
  MediaHealthDto,
  | 'totalVideos'
  | 'analyzedVideos'
  | 'failedVideos'
  | 'pendingVideos'
  | 'playback'
  | 'codecs'
  | 'failures'
>;

export const insightsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  const mediaProbeService = new MediaProbeService();
  const activeReanalysis = new Set<string>();
  const mediaHealthCache = new Map<string, { expiresAt: number; value: MediaHealthInventory }>();
  const mediaHealthInflight = new Map<string, Promise<MediaHealthInventory>>();

  const summarizeAnalysisError = (error: string) => {
    const normalized = error.toLowerCase();
    if (
      normalized.includes('ebml') ||
      normalized.includes('invalid data found') ||
      normalized.includes('invalid as first byte')
    ) {
      return 'Dosya başlığı geçersiz veya içerik bozuk.';
    }
    if (normalized.includes('timeout') || normalized.includes('timed out')) {
      return 'Medya analizi zaman aşımına uğradı.';
    }
    if (normalized.includes('not detected')) {
      return 'Video akışı tespit edilemedi.';
    }
    return 'Medya teknik bilgileri okunamadı.';
  };

  const loadMediaHealthInventory = async (userId: string): Promise<MediaHealthInventory> => {
    const where = {
      status: 'active',
      OR: [
        { mimeType: { startsWith: 'video/' } },
        { mimeType: 'application/octet-stream' },
        { mimeType: 'application/x-matroska' },
      ],
      library: ownedLibraryFilter(userId),
    };
    const select = {
      id: true,
      name: true,
      mediaContainer: true,
      videoCodec: true,
      videoProfile: true,
      videoBitDepth: true,
      audioCodec: true,
      audioChannels: true,
      mediaWidth: true,
      mediaHeight: true,
      mediaDuration: true,
      mediaAnalyzedAt: true,
      mediaAnalysisError: true,
      library: { select: { name: true } },
    } as const;

    const emptyModes = (): Record<PlaybackMode, number> => ({
      direct: 0,
      audio: 0,
      hls: 0,
      full: 0,
    });
    const playback = { safari: emptyModes(), chromium: emptyModes() };
    const videoCodecs = new Map<string, number>();
    const audioCodecs = new Map<string, number>();
    const containers = new Map<string, number>();
    const failures: MediaHealthDto['failures'] = [];
    let totalVideos = 0;
    let analyzedVideos = 0;
    let failedVideos = 0;
    let pendingVideos = 0;

    const increment = (map: Map<string, number>, value?: string | null) => {
      const key = value?.trim().toLowerCase() || 'bilinmiyor';
      map.set(key, (map.get(key) || 0) + 1);
    };
    const normalizeContainer = (value?: string | null) =>
      value?.match(/^(mkv|mp4|m4v|mov|webm|avi|ts|m2ts|flv|wmv|3gp)/i)?.[1] || value;

    let cursorId: string | undefined;
    while (true) {
      const files = await fastify.prisma.driveFile.findMany({
        where,
        select,
        orderBy: { id: 'asc' },
        take: INSIGHTS_PAGE_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (files.length === 0) break;

      totalVideos += files.length;
      for (const file of files) {
        const plan = buildPlaybackPlan(file);
        playback.safari[plan.safari]++;
        playback.chromium[plan.chromium]++;
        increment(videoCodecs, file.videoCodec);
        increment(audioCodecs, file.audioCodec);
        increment(containers, normalizeContainer(file.mediaContainer));

        if (file.mediaAnalyzedAt && !file.mediaAnalysisError) analyzedVideos++;
        if (!file.mediaAnalyzedAt) pendingVideos++;
        if (file.mediaAnalysisError) {
          failedVideos++;
          if (failures.length < 25) {
            failures.push({
              id: file.id,
              name: file.name,
              libraryName: file.library.name,
              error: summarizeAnalysisError(file.mediaAnalysisError),
            });
          }
        }
      }

      cursorId = files[files.length - 1]?.id;
      if (files.length < INSIGHTS_PAGE_SIZE) break;
    }

    const sortedDistribution = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count);

    return {
      totalVideos,
      analyzedVideos,
      failedVideos,
      pendingVideos,
      playback,
      codecs: {
        video: sortedDistribution(videoCodecs),
        audio: sortedDistribution(audioCodecs),
        containers: sortedDistribution(containers),
      },
      failures,
    };
  };

  const getMediaHealthInventory = async (
    userId: string,
    cacheKey: string,
  ): Promise<MediaHealthInventory> => {
    const now = Date.now();
    for (const [cachedKey, entry] of mediaHealthCache) {
      if (entry.expiresAt <= now) mediaHealthCache.delete(cachedKey);
    }

    const cached = mediaHealthCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    const inFlight = mediaHealthInflight.get(cacheKey);
    if (inFlight) return inFlight;

    const pending = loadMediaHealthInventory(userId);
    mediaHealthInflight.set(cacheKey, pending);
    try {
      const value = await pending;
      if (mediaHealthInflight.get(cacheKey) === pending) {
        mediaHealthInflight.delete(cacheKey);
        mediaHealthCache.delete(cacheKey);
        mediaHealthCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + MEDIA_HEALTH_CACHE_TTL_MS,
        });
        if (mediaHealthCache.size > 128) {
          const oldestCacheKey = mediaHealthCache.keys().next().value;
          if (oldestCacheKey) mediaHealthCache.delete(oldestCacheKey);
        }
      }
      return value;
    } catch (error) {
      if (mediaHealthInflight.get(cacheKey) === pending) mediaHealthInflight.delete(cacheKey);
      throw error;
    }
  };

  const invalidateMediaHealthInventory = (userId: string) => {
    const userCachePrefix = `${userId}:`;
    for (const cacheKey of mediaHealthCache.keys()) {
      if (cacheKey.startsWith(userCachePrefix)) mediaHealthCache.delete(cacheKey);
    }
    for (const cacheKey of mediaHealthInflight.keys()) {
      if (cacheKey.startsWith(userCachePrefix)) mediaHealthInflight.delete(cacheKey);
    }
  };

  // GET /api/insights/storage: Analyze Drive Storage & Quota
  fastify.get('/storage', async (request, reply) => {
    const userId = request.user!.id;
    const where = {
      where: {
        status: 'active',
        library: ownedLibraryFilter(userId),
      },
      orderBy: { id: 'asc' as const },
      take: INSIGHTS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        size: true,
        md5Checksum: true,
        googleDriveFileId: true,
        library: { select: { name: true } },
      },
    };

    type StorageFile = Awaited<ReturnType<typeof fastify.prisma.driveFile.findMany<typeof where>>>[number];
    let cursorId: string | undefined;

    let totalFiles = 0;
    let totalSizeBytes = 0;

    const resolutionStats = {
      k4: { count: 0, sizeBytes: 0 },
      p1080: { count: 0, sizeBytes: 0 },
      p720: { count: 0, sizeBytes: 0 },
      sd: { count: 0, sizeBytes: 0 },
    };

    const nameMap = new Map<string, StorageFile[]>();
    const md5Map = new Map<string, StorageFile[]>();

    const largestFilesList: Array<{
      id: string;
      name: string;
      size: number;
      libraryName: string;
      googleDriveFileId: string;
    }> = [];

    const addLargestFile = (file: StorageFile, sizeNum: number) => {
      largestFilesList.push({
        id: file.id,
        name: file.name,
        size: sizeNum,
        libraryName: file.library?.name || 'Bilinmeyen',
        googleDriveFileId: file.googleDriveFileId || '',
      });
      largestFilesList.sort((a, b) => b.size - a.size);
      if (largestFilesList.length > 10) largestFilesList.pop();
    };

    while (true) {
      const files = await fastify.prisma.driveFile.findMany({
        ...where,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (files.length === 0) break;

      for (const file of files) {
        totalFiles++;
        const sizeNum = file.size ? Number(file.size) : 0;
        totalSizeBytes += sizeNum;

        // Classify resolution
        const fileNameLower = file.name.toLowerCase();
        if (
          fileNameLower.includes('2160p') ||
          fileNameLower.includes('4k') ||
          sizeNum > 8 * 1024 * 1024 * 1024
        ) {
          resolutionStats.k4.count++;
          resolutionStats.k4.sizeBytes += sizeNum;
        } else if (
          fileNameLower.includes('1080p') ||
          (sizeNum > 2.5 * 1024 * 1024 * 1024 && sizeNum <= 8 * 1024 * 1024 * 1024)
        ) {
          resolutionStats.p1080.count++;
          resolutionStats.p1080.sizeBytes += sizeNum;
        } else if (
          fileNameLower.includes('720p') ||
          (sizeNum > 1 * 1024 * 1024 * 1024 && sizeNum <= 2.5 * 1024 * 1024 * 1024)
        ) {
          resolutionStats.p720.count++;
          resolutionStats.p720.sizeBytes += sizeNum;
        } else {
          resolutionStats.sd.count++;
          resolutionStats.sd.sizeBytes += sizeNum;
        }

        // Group for duplicates
        if (file.md5Checksum) {
          const list = md5Map.get(file.md5Checksum) || [];
          list.push(file);
          md5Map.set(file.md5Checksum, list);
        }

        const cleanName = fileNameLower.trim();
        const listByName = nameMap.get(cleanName) || [];
        listByName.push(file);
        nameMap.set(cleanName, listByName);

        addLargestFile(file, sizeNum);
      }

      cursorId = files[files.length - 1]?.id;
      if (files.length < INSIGHTS_PAGE_SIZE) break;
    }

    // Sort largest files
    const topLargestFiles = largestFilesList.slice(0, 10);

    // Identify duplicates
    const duplicates: Array<{
      id: string;
      name: string;
      size: number;
      libraryName: string;
      googleDriveFileId: string;
      reason: string;
    }> = [];

    const addedDuplicateIds = new Set<string>();

    for (const [md5, list] of md5Map.entries()) {
      if (list.length > 1) {
        for (const item of list) {
          if (!addedDuplicateIds.has(item.id)) {
            addedDuplicateIds.add(item.id);
            duplicates.push({
              id: item.id,
              name: item.name,
              size: item.size ? Number(item.size) : 0,
              libraryName: item.library?.name || 'Bilinmeyen',
              googleDriveFileId: item.googleDriveFileId || '',
              reason: `Aynı MD5 Özeti (${md5.substring(0, 8)}...)`,
            });
          }
        }
      }
    }

    for (const [, list] of nameMap.entries()) {
      if (list.length > 1) {
        for (const item of list) {
          if (!addedDuplicateIds.has(item.id)) {
            addedDuplicateIds.add(item.id);
            duplicates.push({
              id: item.id,
              name: item.name,
              size: item.size ? Number(item.size) : 0,
              libraryName: item.library?.name || 'Bilinmeyen',
              googleDriveFileId: item.googleDriveFileId || '',
              reason: 'Aynı Dosya Adı',
            });
          }
        }
      }
    }

    const averageSizeBytes = totalFiles > 0 ? Math.round(totalSizeBytes / totalFiles) : 0;

    return reply.status(200).send({
      totalFiles,
      totalSizeBytes,
      averageSizeBytes,
      resolutions: resolutionStats,
      duplicates,
      largestFiles: topLargestFiles,
    });
  });

  fastify.get('/media-health', async (request, reply) => {
    const userId = request.user!.id;
    const accessibleLibraries = await fastify.prisma.library.findMany({
      where: ownedLibraryFilter(userId),
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    // A changed membership set gets a separate cache key, so a revoked library
    // cannot remain visible through a cached inventory.
    const cacheKey = `${userId}:${accessibleLibraries.map((library) => library.id).join(',')}`;
    const inventory = await getMediaHealthInventory(userId, cacheKey);

    const hlsStats = fastify.hlsService.getStats();
    const runtimeHls =
      request.user!.role === 'admin'
        ? hlsStats
        : {
            ...hlsStats,
            // HLS jobs are currently process-global. Do not expose media names,
            // cache keys or queue entries from another library to a regular
            // account until the scheduler carries per-user ownership.
            jobs: [],
            queue: [],
          };

    const response: MediaHealthDto = {
      ...inventory,
      runtime: {
        hls: runtimeHls,
        transcode: fastify.transcodeService.getStats(),
        playerTelemetry: fastify.playerTelemetryService.getStats({
          includeRecent: request.user!.role === 'admin',
        }),
      },
    };

    return reply.status(200).send(response);
  });

  fastify.post<{
    Body: {
      mediaId?: string;
      driveFileId?: string;
      browser?: 'safari' | 'chromium' | 'other';
      playbackMode?: PlaybackMode;
      event?: 'first-frame' | 'stall' | 'seek-recovery' | 'error';
      durationMs?: number;
    };
  }>('/player-telemetry', async (request, reply) => {
    const body = request.body || {};
    if (
      !body.mediaId ||
      !body.driveFileId ||
      !body.browser ||
      !body.playbackMode ||
      !body.event ||
      (body.durationMs !== undefined &&
        (!Number.isFinite(body.durationMs) || body.durationMs < 0 || body.durationMs > 10 * 60_000))
    ) {
      return reply.status(400).send();
    }
    const [media, driveFile] = await Promise.all([
      fastify.prisma.mediaItem.findFirst({
        where: { id: body.mediaId, ...ownedMediaFilter(request.user!.id) },
        select: { id: true },
      }),
      fastify.prisma.driveFile.findFirst({
        where: {
          id: body.driveFileId,
          status: 'active',
          library: ownedLibraryFilter(request.user!.id),
        },
        select: { id: true },
      }),
    ]);

    // Telemetry is best-effort. Silently discard identifiers outside the
    // caller's catalogue instead of turning this endpoint into an ownership
    // oracle or allowing a user to poison the administrator's global metrics.
    if (!media || !driveFile) return reply.status(202).send();

    fastify.playerTelemetryService.record({
      mediaId: body.mediaId,
      driveFileId: body.driveFileId,
      browser: body.browser,
      playbackMode: body.playbackMode,
      event: body.event,
      durationMs: body.durationMs === undefined ? undefined : Math.round(body.durationMs),
      occurredAt: Date.now(),
    });
    return reply.status(202).send();
  });

  fastify.post<{ Params: { jobId: string } }>(
    '/media-health/hls/:jobId/stop',
    async (request, reply) => {
      if (request.user!.role !== 'admin') {
        return reply.code(403).send({
          error: {
            code: 'ADMIN_REQUIRED',
            message: 'HLS işlerini durdurmak için yönetici yetkisi gerekir.',
            requestId: request.id,
          },
        });
      }
      const stopped = fastify.hlsService.stopJob(request.params.jobId);
      if (!stopped) {
        return reply.status(404).send({
          error: {
            code: 'HLS_JOB_NOT_FOUND',
            message: 'Aktif HLS işi bulunamadı.',
            requestId: request.id,
          },
        });
      }
      return reply.status(200).send({ stopped: true });
    },
  );

  fastify.post<{ Params: { driveFileId: string } }>(
    '/media-health/:driveFileId/reanalyze',
    async (request, reply) => {
      const userId = request.user!.id;
      const driveFile = await fastify.prisma.driveFile.findFirst({
        where: {
          id: request.params.driveFileId,
          status: 'active',
          library: ownedLibraryFilter(userId),
        },
        include: { library: true },
      });

      if (!driveFile) {
        return reply.status(404).send({
          error: {
            code: 'MEDIA_FILE_NOT_FOUND',
            message: 'Yeniden analiz edilecek medya dosyası bulunamadı.',
            requestId: request.id,
          },
        });
      }

      if (activeReanalysis.has(driveFile.id)) {
        return reply.status(409).send({
          error: {
            code: 'MEDIA_ANALYSIS_IN_PROGRESS',
            message: 'Bu dosya zaten analiz ediliyor.',
            requestId: request.id,
          },
        });
      }

      activeReanalysis.add(driveFile.id);
      try {
        let metadata;
        if (driveFile.storageType === 'local' && driveFile.localFilePath) {
          const localFilePath = await resolveSafeLocalFile(
            driveFile.library.localFolderPath,
            driveFile.localFilePath,
          );
          metadata = await mediaProbeService.probeLocalFile(localFilePath);
        } else {
          const { accessToken } = await fastify.driveAccessService.getAccess(userId, driveFile);
          metadata = await mediaProbeService.probeRemoteFile({
            name: driveFile.name,
            size: driveFile.size || 0n,
            readRange: (start, end) =>
              fastify.driveService.getMediaRangeBuffer(
                accessToken,
                driveFile.googleDriveFileId || '',
                start,
                end,
              ),
          });
        }

        await fastify.prisma.driveFile.update({
          where: { id: driveFile.id },
          data: metadata,
        });
        invalidateMediaHealthInventory(userId);
        return reply.status(200).send({
          success: true,
          message: 'Medya teknik bilgileri güncellendi.',
        });
      } catch (error) {
        const rawError =
          error instanceof Error ? error.message.slice(0, 500) : 'MEDIA_PROBE_FAILED';
        await fastify.prisma.driveFile.update({
          where: { id: driveFile.id },
          data: {
            mediaAnalyzedAt: new Date(),
            mediaAnalysisError: rawError,
          },
        });
        invalidateMediaHealthInventory(userId);
        return reply.status(422).send({
          error: {
            code: 'MEDIA_ANALYSIS_FAILED',
            message: summarizeAnalysisError(rawError),
            requestId: request.id,
          },
        });
      } finally {
        activeReanalysis.delete(driveFile.id);
      }
    },
  );
};

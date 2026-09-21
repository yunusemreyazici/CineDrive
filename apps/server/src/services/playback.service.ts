import type { PrismaClient, Prisma } from '@cinedrive/prisma';
import type { UpdateProgressInput } from '@cinedrive/shared';
import { ownedMediaFilter } from '../utils/library-access.js';

const DEFAULT_COMPLETION_THRESHOLD_PERCENT = 92;
const MINIMUM_PROGRESS_SECONDS = 15;
const MAX_DURATION_SECONDS = 360000; // 100 Hours max limit
const GENERAL_TRACKING_KEY = '__media__';

export class PlaybackService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Updates playback progress for a movie or series episode
   */
  public async updateProgress(
    userId: string,
    data: UpdateProgressInput & { clientTimestamp?: number; deviceType?: string },
  ) {
    const { mediaItemId, episodeId, clientTimestamp } = data;
    let positionSeconds = data.positionSeconds;
    let durationSeconds = data.durationSeconds;

    // 1. Numeric validation & sanitization
    if (
      !Number.isFinite(positionSeconds) ||
      !Number.isFinite(durationSeconds) ||
      positionSeconds < 0 ||
      durationSeconds < 0
    ) {
      throw new Error('INVALID_NUMERIC_VALUES');
    }

    if (durationSeconds > MAX_DURATION_SECONDS) {
      durationSeconds = MAX_DURATION_SECONDS;
    }

    positionSeconds = Math.min(positionSeconds, durationSeconds);

    // 2. Calculate percentage & completed status
    const percentage = durationSeconds > 0 ? (positionSeconds / durationSeconds) * 100 : 0;
    const isCompleted = percentage >= DEFAULT_COMPLETION_THRESHOLD_PERCENT;
    const trackingKey = episodeId || GENERAL_TRACKING_KEY;

    // All reads and writes below share one SQLite transaction. The non-null
    // trackingKey gives movies/series-level rows a real unique identity even
    // though episodeId remains nullable for API and relational compatibility.
    return this.prisma.$transaction(async (tx) => {
      // 3. Validate MediaItem and optional episode inside the write transaction
      // so a revoke/delete racing this request cannot authorize stale data.
      const mediaItem = await tx.mediaItem.findFirst({
        where: { id: mediaItemId, ...ownedMediaFilter(userId) },
      });
      if (!mediaItem) throw new Error('MEDIA_NOT_FOUND');

      if (episodeId) {
        const episode = await tx.episode.findFirst({ where: { id: episodeId, mediaItemId } });
        if (!episode) throw new Error('INVALID_EPISODE');
      }

      const existing = await tx.playbackProgress.findUnique({
        where: {
          userId_mediaItemId_trackingKey: { userId, mediaItemId, trackingKey },
        },
      });

      if (existing && Number.isFinite(clientTimestamp)) {
        const existingTime = existing.lastPlayedAt.getTime();
        if (existingTime - (clientTimestamp as number) > 5000) {
          return tx.playbackProgress.findUniqueOrThrow({
            where: { id: existing.id },
            include: { mediaItem: true, episode: true },
          });
        }
      }

      const now = new Date();
      const progressData = {
        positionSeconds,
        durationSeconds,
        percentage,
        completed: isCompleted,
        lastPlayedAt: now,
        completedAt: isCompleted ? existing?.completedAt || now : null,
      };
      const progress = await tx.playbackProgress.upsert({
        where: {
          userId_mediaItemId_trackingKey: { userId, mediaItemId, trackingKey },
        },
        update: progressData,
        create: {
          userId,
          mediaItemId,
          episodeId: episodeId || null,
          trackingKey,
          ...progressData,
          firstStartedAt: now,
        },
        include: { mediaItem: true, episode: true },
      });

      const existingHistory = await tx.watchHistory.findUnique({
        where: {
          userId_mediaItemId_trackingKey: { userId, mediaItemId, trackingKey },
        },
      });
      await tx.watchHistory.upsert({
        where: {
          userId_mediaItemId_trackingKey: { userId, mediaItemId, trackingKey },
        },
        update: {
          positionSeconds,
          durationSeconds,
          completed: isCompleted,
          deviceType: data.deviceType || existingHistory?.deviceType || 'unknown',
          watchedAt: now,
        },
        create: {
          userId,
          mediaItemId,
          episodeId: episodeId || null,
          trackingKey,
          positionSeconds,
          durationSeconds,
          completed: isCompleted,
          deviceType: data.deviceType || 'unknown',
          watchedAt: now,
        },
      });

      if (episodeId) {
        // Older player versions saved a series-level NULL record. Remove the
        // legacy sibling in the same transaction as the concrete episode row.
        await tx.playbackProgress.deleteMany({
          where: { userId, mediaItemId, trackingKey: GENERAL_TRACKING_KEY },
        });
        await tx.watchHistory.deleteMany({
          where: { userId, mediaItemId, trackingKey: GENERAL_TRACKING_KEY },
        });
      }

      return progress;
    });
  }

  public async repairDuplicateTrackingRecords() {
    // The tracking-key migration performs the one-time duplicate merge before
    // creating the unique indexes. Startup must not read the whole catalogue
    // into JS (or do an O(n²) duplicate pass) on every restart. This bounded
    // SQL repair only restores a history row if an older deployment left one
    // missing; INSERT OR IGNORE makes it safe to run repeatedly.
    const historyRestored = await this.prisma.$executeRaw`
      INSERT OR IGNORE INTO "WatchHistory" (
        "id",
        "userId",
        "mediaItemId",
        "episodeId",
        "trackingKey",
        "positionSeconds",
        "durationSeconds",
        "completed",
        "watchedAt",
        "createdAt",
        "updatedAt"
      )
      SELECT
        lower(hex(randomblob(16))),
        progress."userId",
        progress."mediaItemId",
        progress."episodeId",
        progress."trackingKey",
        progress."positionSeconds",
        progress."durationSeconds",
        progress."completed",
        progress."lastPlayedAt",
        progress."lastPlayedAt",
        progress."lastPlayedAt"
      FROM "PlaybackProgress" AS progress
      LEFT JOIN "WatchHistory" AS history
        ON history."userId" = progress."userId"
       AND history."mediaItemId" = progress."mediaItemId"
       AND history."trackingKey" = progress."trackingKey"
      WHERE history."id" IS NULL
    `;

    return { progressRemoved: 0, historyRemoved: 0, historyRestored: Number(historyRestored) };
  }

  /**
   * Returns list of "Continue Watching" items for the active user
   */
  public async getContinueWatchingList(userId: string) {
    // Select the newest eligible progress row per media in SQLite before
    // loading relations. A flat `ORDER BY ... LIMIT 20` lets one long series
    // consume the entire page with its episodes and returns fewer than 20
    // distinct titles. The NOT EXISTS anti-join keeps this bounded at 20 rows.
    const candidateRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT progress."id"
      FROM "PlaybackProgress" AS progress
      JOIN "MediaItem" AS media ON media."id" = progress."mediaItemId"
      JOIN "Library" AS library ON library."id" = media."libraryId"
      LEFT JOIN "LibraryMembership" AS membership
        ON membership."libraryId" = library."id" AND membership."userId" = ${userId}
      WHERE progress."userId" = ${userId}
        AND progress."completed" = 0
        AND progress."positionSeconds" >= ${MINIMUM_PROGRESS_SECONDS}
        AND (library."userId" = ${userId} OR membership."userId" IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM "PlaybackProgress" AS newer
          WHERE newer."userId" = progress."userId"
            AND newer."mediaItemId" = progress."mediaItemId"
            AND newer."completed" = 0
            AND newer."positionSeconds" >= ${MINIMUM_PROGRESS_SECONDS}
            AND (
              newer."lastPlayedAt" > progress."lastPlayedAt"
              OR (
                newer."lastPlayedAt" = progress."lastPlayedAt"
                AND newer."id" > progress."id"
              )
            )
        )
      ORDER BY progress."lastPlayedAt" DESC, progress."id" DESC
      LIMIT 20
    `;

    if (candidateRows.length === 0) return [];

    const fetchedItems = await this.prisma.playbackProgress.findMany({
      where: { id: { in: candidateRows.map((row) => row.id) } },
      include: {
        mediaItem: {
          include: {
            movie: true,
            series: {
              include: {
                seasons: {
                  orderBy: { seasonNumber: 'asc' },
                  take: 1,
                  include: {
                    episodes: {
                      orderBy: { episodeNumber: 'asc' },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
        episode: true,
      },
    });
    const itemById = new Map(fetchedItems.map((item) => [item.id, item]));
    const items = candidateRows
      .map((row) => itemById.get(row.id))
      .filter((item): item is (typeof fetchedItems)[number] => Boolean(item));

    return items.map((item) => {
      let continueUrl = `/watch/${item.mediaItemId}`;
      if (item.mediaItem.type === 'series') {
        const activeEpId = item.episodeId || item.mediaItem.series?.seasons[0]?.episodes[0]?.id;
        continueUrl = `/watch/${item.mediaItemId}/${activeEpId || ''}`;
      }

      return {
        id: item.id,
        mediaItemId: item.mediaItemId,
        episodeId: item.episodeId,
        mediaItem: item.mediaItem,
        episode: item.episode,
        positionSeconds: item.positionSeconds,
        durationSeconds: item.durationSeconds,
        percentage: item.percentage,
        completed: item.completed,
        lastPlayedAt: item.lastPlayedAt,
        continueUrl,
      };
    });
  }

  /**
   * Returns progress details for a single media item
   */
  public async getMediaProgress(userId: string, mediaItemId: string) {
    return this.prisma.playbackProgress.findMany({
      where: { userId, mediaItemId, mediaItem: ownedMediaFilter(userId) },
      orderBy: { lastPlayedAt: 'desc' },
    });
  }

  /**
   * Resets playback progress for a media item
   */
  public async resetProgress(userId: string, mediaItemId: string) {
    await this.prisma.playbackProgress.deleteMany({
      where: { userId, mediaItemId, mediaItem: ownedMediaFilter(userId) },
    });
  }

  /**
   * Returns paginated watch history with type and status filters
   */
  public async getWatchHistory(
    userId: string,
    params: { page?: number; limit?: number; type?: string },
  ) {
    const page = Number.isFinite(params.page)
      ? Math.max(1, Math.floor(params.page!))
      : 1;
    const limit = Number.isFinite(params.limit)
      ? Math.min(50, Math.max(1, Math.floor(params.limit!)))
      : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.WatchHistoryWhereInput = {
      userId,
      mediaItem: ownedMediaFilter(userId),
    };

    if (params.type === 'movie' || params.type === 'series') {
      where.mediaItem = { AND: [ownedMediaFilter(userId), { type: params.type }] };
    } else if (params.type === 'completed') {
      where.completed = true;
    } else if (params.type === 'in_progress') {
      where.completed = false;
    }

    const [history, total] = await Promise.all([
      this.prisma.watchHistory.findMany({
        where,
        orderBy: { watchedAt: 'desc' },
        skip,
        take: limit,
        include: {
          mediaItem: true,
          episode: true,
        },
      }),
      this.prisma.watchHistory.count({ where }),
    ]);

    return {
      history,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Deletes a single watch history entry
   */
  public async deleteWatchHistoryItem(userId: string, historyId: string) {
    const existing = await this.prisma.watchHistory.findFirst({
      where: { id: historyId, userId, mediaItem: ownedMediaFilter(userId) },
    });

    if (!existing) {
      throw new Error('HISTORY_NOT_FOUND');
    }

    await this.prisma.$transaction([
      this.prisma.watchHistory.delete({ where: { id: historyId } }),
      this.prisma.playbackProgress.deleteMany({
        where: {
          userId,
          mediaItemId: existing.mediaItemId,
          trackingKey: existing.trackingKey,
        },
      }),
    ]);
  }

  /**
   * Clears the entire watch history and every saved resume position for the
   * active user. Keeping these tables in sync prevents deleted history from
   * reappearing as a "continue watching" prompt.
   */
  public async clearWatchHistory(userId: string) {
    await this.prisma.$transaction([
      this.prisma.watchHistory.deleteMany({
        where: { userId },
      }),
      this.prisma.playbackProgress.deleteMany({
        where: { userId },
      }),
    ]);
  }
}

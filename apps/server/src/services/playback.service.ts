import type { PrismaClient, Prisma } from '@cinedrive/prisma';
import type { UpdateProgressInput } from '@cinedrive/shared';

const DEFAULT_COMPLETION_THRESHOLD_PERCENT = 92;
const MINIMUM_PROGRESS_SECONDS = 15;
const MAX_DURATION_SECONDS = 360000; // 100 Hours max limit

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

    // 2. Validate MediaItem exists
    const mediaItem = await this.prisma.mediaItem.findUnique({
      where: { id: mediaItemId },
    });

    if (!mediaItem) {
      throw new Error('MEDIA_NOT_FOUND');
    }

    // 3. If episodeId is provided, validate it belongs to this MediaItem
    if (episodeId) {
      const episode = await this.prisma.episode.findFirst({
        where: {
          id: episodeId,
          mediaItemId,
        },
      });

      if (!episode) {
        throw new Error('INVALID_EPISODE');
      }
    }

    // 4. Calculate percentage & completed status
    const percentage = durationSeconds > 0 ? (positionSeconds / durationSeconds) * 100 : 0;
    const isCompleted = percentage >= DEFAULT_COMPLETION_THRESHOLD_PERCENT;

    // 5. Check existing progress for stale write protection
    const existing = await this.prisma.playbackProgress.findFirst({
      where: {
        userId,
        mediaItemId,
        episodeId: episodeId || null,
      },
    });

    if (existing && clientTimestamp) {
      const existingTime = existing.lastPlayedAt.getTime();
      if (existingTime - clientTimestamp > 5000) {
        // Incoming request is older than current database record; return current DB record without overwriting
        return existing;
      }
    }

    const now = new Date();

    // 6. Upsert PlaybackProgress
    const progressData = {
      positionSeconds,
      durationSeconds,
      percentage,
      completed: isCompleted,
      lastPlayedAt: now,
      completedAt: isCompleted ? existing?.completedAt || now : null,
    };
    const progress = existing
      ? await this.prisma.playbackProgress.update({
          where: { id: existing.id },
          data: progressData,
          include: {
            mediaItem: true,
            episode: true,
          },
        })
      : await this.prisma.playbackProgress.create({
          data: {
            userId,
            mediaItemId,
            episodeId: episodeId || null,
            ...progressData,
            firstStartedAt: now,
          },
          include: {
            mediaItem: true,
            episode: true,
          },
        });

    // 7. Update WatchHistory without relying on a nullable compound unique
    // key. SQLite treats NULL values as distinct, so Prisma upsert would
    // create a new movie/general-series row on every progress save.
    const existingHistory = await this.prisma.watchHistory.findFirst({
      where: {
        userId,
        mediaItemId,
        episodeId: episodeId || null,
      },
    });
    if (existingHistory) {
      await this.prisma.watchHistory.update({
        where: { id: existingHistory.id },
        data: {
          positionSeconds,
          durationSeconds,
          completed: isCompleted,
          deviceType: data.deviceType || existingHistory.deviceType,
          watchedAt: now,
        },
      });
    } else {
      await this.prisma.watchHistory.create({
        data: {
          userId,
          mediaItemId,
          episodeId: episodeId || null,
          positionSeconds,
          durationSeconds,
          completed: isCompleted,
          deviceType: data.deviceType || 'unknown',
          watchedAt: now,
        },
      });
    }

    if (episodeId) {
      // Older player versions saved the first selected episode as a
      // series-level NULL record. Once a concrete episode is saved, discard
      // that legacy sibling so the series appears only once.
      await this.prisma.$transaction([
        this.prisma.playbackProgress.deleteMany({
          where: { userId, mediaItemId, episodeId: null },
        }),
        this.prisma.watchHistory.deleteMany({
          where: { userId, mediaItemId, episodeId: null },
        }),
      ]);
    }

    return progress;
  }

  public async repairDuplicateTrackingRecords() {
    const [progressRows, historyRows] = await Promise.all([
      this.prisma.playbackProgress.findMany({
        orderBy: { lastPlayedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          mediaItemId: true,
          episodeId: true,
          positionSeconds: true,
          durationSeconds: true,
          completed: true,
          lastPlayedAt: true,
        },
      }),
      this.prisma.watchHistory.findMany({
        orderBy: { watchedAt: 'desc' },
        select: { id: true, userId: true, mediaItemId: true, episodeId: true },
      }),
    ]);

    const duplicateIds = <
      T extends {
        id: string;
        userId: string;
        mediaItemId: string;
        episodeId: string | null;
      },
    >(
      rows: T[],
    ) => {
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const row of rows) {
        const key = `${row.userId}:${row.mediaItemId}:${row.episodeId || 'no-episode'}`;
        if (seen.has(key)) duplicates.push(row.id);
        else seen.add(key);
      }
      return duplicates;
    };

    const progressDuplicates = duplicateIds(progressRows);
    const historyDuplicates = duplicateIds(historyRows);
    const [progressResult, historyResult] = await this.prisma.$transaction([
      this.prisma.playbackProgress.deleteMany({
        where: { id: { in: progressDuplicates } },
      }),
      this.prisma.watchHistory.deleteMany({
        where: { id: { in: historyDuplicates } },
      }),
    ]);

    const trackingKey = (row: { userId: string; mediaItemId: string; episodeId: string | null }) =>
      `${row.userId}:${row.mediaItemId}:${row.episodeId || 'no-episode'}`;
    const retainedProgress = progressRows.filter((row) => !progressDuplicates.includes(row.id));
    const retainedHistoryKeys = new Set(
      historyRows
        .filter((row) => !historyDuplicates.includes(row.id))
        .map((row) => trackingKey(row)),
    );
    const missingHistory = retainedProgress.filter(
      (row) => !retainedHistoryKeys.has(trackingKey(row)),
    );
    if (missingHistory.length > 0) {
      await this.prisma.watchHistory.createMany({
        data: missingHistory.map((row) => ({
          userId: row.userId,
          mediaItemId: row.mediaItemId,
          episodeId: row.episodeId,
          positionSeconds: row.positionSeconds,
          durationSeconds: row.durationSeconds,
          completed: row.completed,
          watchedAt: row.lastPlayedAt,
        })),
      });
    }

    return {
      progressRemoved: progressResult.count,
      historyRemoved: historyResult.count,
      historyRestored: missingHistory.length,
    };
  }

  /**
   * Returns list of "Continue Watching" items for the active user
   */
  public async getContinueWatchingList(userId: string) {
    const items = await this.prisma.playbackProgress.findMany({
      where: {
        userId,
        completed: false,
        positionSeconds: { gte: MINIMUM_PROGRESS_SECONDS },
      },
      orderBy: { lastPlayedAt: 'desc' },
      take: 20,
      include: {
        mediaItem: {
          include: {
            movie: true,
            series: {
              include: {
                seasons: {
                  orderBy: { seasonNumber: 'asc' },
                  include: {
                    episodes: {
                      orderBy: { episodeNumber: 'asc' },
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

    // Deduplicate by mediaItemId so each movie or series appears at most once
    const seenMediaIds = new Set<string>();
    const uniqueItems = [];

    for (const item of items) {
      if (!seenMediaIds.has(item.mediaItemId)) {
        seenMediaIds.add(item.mediaItemId);
        uniqueItems.push(item);
      }
    }

    return uniqueItems.map((item) => {
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
      where: { userId, mediaItemId },
      orderBy: { lastPlayedAt: 'desc' },
    });
  }

  /**
   * Resets playback progress for a media item
   */
  public async resetProgress(userId: string, mediaItemId: string) {
    await this.prisma.playbackProgress.deleteMany({
      where: { userId, mediaItemId },
    });
  }

  /**
   * Returns paginated watch history with type and status filters
   */
  public async getWatchHistory(
    userId: string,
    params: { page?: number; limit?: number; type?: string },
  ) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(50, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.WatchHistoryWhereInput = { userId };

    if (params.type === 'movie' || params.type === 'series') {
      where.mediaItem = { type: params.type };
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
      where: { id: historyId, userId },
    });

    if (!existing) {
      throw new Error('HISTORY_NOT_FOUND');
    }

    await this.prisma.watchHistory.delete({
      where: { id: historyId },
    });
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

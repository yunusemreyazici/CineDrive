import type { PrismaClient } from '@cinedrive/prisma';
import { runWithConcurrency } from '../utils/concurrency.js';
import { MetadataService } from './metadata.service.js';

export interface MetadataEnrichmentTarget {
  libraryId: string;
  mediaItemId: string;
  title: string;
  type: 'movie' | 'series';
  year?: number;
  userApiKey?: string;
  refreshMedia: boolean;
  seriesId?: string;
  refreshEpisodes?: boolean;
}

const METADATA_ENRICHMENT_CONCURRENCY = 4;

/** Keeps provider latency out of the core file and episode indexing pass. */
export class MetadataEnrichmentService {
  private readonly metadataService = new MetadataService();

  constructor(private readonly prisma: PrismaClient) {}

  public async enrichAfterIndexing(
    targets: readonly MetadataEnrichmentTarget[],
    signal?: AbortSignal,
    heartbeat?: () => Promise<void>,
  ): Promise<void> {
    const uniqueTargets = Array.from(
      new Map(targets.map((target) => [target.mediaItemId, target])).values(),
    );
    if (uniqueTargets.length === 0) return;

    await runWithConcurrency(
      uniqueTargets,
      METADATA_ENRICHMENT_CONCURRENCY,
      async (target) => {
        try {
          signal?.throwIfAborted();
          await heartbeat?.();
          const [metadata, episodes] = await Promise.all([
            target.refreshMedia
              ? this.metadataService.fetchMetadata(
                  target.title,
                  target.type,
                  target.userApiKey,
                  signal,
                )
              : Promise.resolve(null),
            target.refreshEpisodes && target.seriesId
              ? this.metadataService.fetchShowEpisodes(target.title, signal)
              : Promise.resolve(null),
          ]);
          signal?.throwIfAborted();
          await heartbeat?.();

          if (metadata) {
            await this.prisma.mediaItem.updateMany({
              where: { id: target.mediaItemId, libraryId: target.libraryId },
              data: {
                year: target.year ?? metadata.year,
                overview: metadata.overview || undefined,
                posterUrl: metadata.posterUrl || undefined,
                backdropUrl: metadata.backdropUrl || undefined,
                voteAverage: metadata.voteAverage,
                voteCount: metadata.voteCount,
                genres: metadata.genres ? JSON.stringify(metadata.genres) : undefined,
                cast: metadata.cast ? JSON.stringify(metadata.cast) : undefined,
                trailerUrl: metadata.trailerUrl,
                contentRating: metadata.contentRating,
                tmdbId: metadata.tmdbId,
                imdbId: metadata.imdbId,
              },
            });
          }

          if (episodes && target.seriesId) {
            const rows = await this.prisma.episode.findMany({
              where: { seriesId: target.seriesId },
              select: { id: true, seasonNumber: true, episodeNumber: true },
            });
            for (const episode of rows) {
              const remote = episodes.get(`${episode.seasonNumber}x${episode.episodeNumber}`);
              if (!remote) continue;
              await this.prisma.episode.updateMany({
                where: { id: episode.id },
                data: {
                  title: remote.name,
                  overview: remote.overview || undefined,
                  stillUrl: remote.stillUrl || undefined,
                },
              });
            }
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          console.warn(
            `[MetadataEnrichment] Background enrichment failed for ${target.mediaItemId} (${error instanceof Error ? error.name : 'unknown error'}).`,
          );
        }
      },
      signal,
    );
  }
}

import { z } from 'zod';

export const musicListQuerySchema = z.object({
  search: z.string().trim().optional(),
  artistId: z.string().uuid().optional(),
  albumId: z.string().uuid().optional(),
  sortBy: z.enum(['title', 'artist', 'album', 'year', 'createdAt']).default('title'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createMusicPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

export const updateMusicPlaylistSchema = createMusicPlaylistSchema.partial();

export const addMusicPlaylistItemSchema = z.object({ trackId: z.string().uuid() });

export const reorderMusicPlaylistSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

export const updateMusicPlaybackStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  currentTrackId: z.string().uuid().nullable(),
  currentQueueItemId: z.string().uuid().nullable().optional(),
  positionSeconds: z.number().finite().nonnegative(),
  shuffleEnabled: z.boolean(),
  repeatMode: z.enum(['off', 'all', 'one']),
  queue: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        trackId: z.string().uuid(),
        sourceOrder: z.number().int().nonnegative(),
        playOrder: z.number().int().nonnegative(),
      }),
    )
    .max(1000),
});

export const createMusicHistorySchema = z.object({
  trackId: z.string().uuid(),
  listenedSeconds: z.number().finite().nonnegative(),
});

export type MusicListQueryInput = z.infer<typeof musicListQuerySchema>;
export type CreateMusicPlaylistInput = z.infer<typeof createMusicPlaylistSchema>;
export type UpdateMusicPlaylistInput = z.infer<typeof updateMusicPlaylistSchema>;
export type UpdateMusicPlaybackStateInput = z.infer<typeof updateMusicPlaybackStateSchema>;

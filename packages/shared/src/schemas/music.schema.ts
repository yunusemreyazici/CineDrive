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

export const updateMusicLyricsSchema = z.object({
  content: z.string().max(1024 * 1024),
  translatedContent: z
    .string()
    .max(1024 * 1024)
    .nullable()
    .optional(),
  romanizedContent: z
    .string()
    .max(1024 * 1024)
    .nullable()
    .optional(),
  sourceName: z.string().trim().min(1).max(255).default('manual.lrc'),
  language: z.string().trim().min(2).max(16).nullable().optional(),
  translationLanguage: z.string().trim().min(2).max(16).nullable().optional(),
});

export const musicBulkMetadataSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(500),
  artist: z.string().trim().min(1).max(200).optional(),
  album: z.string().trim().min(1).max(300).optional(),
  albumArtist: z.string().trim().min(1).max(200).optional(),
  genres: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  metadataLocked: z.boolean().optional(),
});

export const musicAlbumMaintenanceSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  artist: z.string().trim().min(1).max(200).optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  releaseType: z.string().trim().min(1).max(50).optional(),
});

export const musicArtistMaintenanceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sortName: z.string().trim().max(200).nullable().optional(),
});

export const musicReplayGainScanSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(100),
});

export const musicTrackCreditInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z
    .enum([
      'performer',
      'composer',
      'lyricist',
      'songwriter',
      'producer',
      'conductor',
      'arranger',
      'remixer',
      'mixer',
      'engineer',
    ])
    .or(z.string().trim().min(1).max(50)),
  instrument: z.string().trim().max(120).nullable().optional(),
  musicbrainzId: z.string().uuid().nullable().optional(),
});

export const updateMusicTrackMetadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(200),
  album: z.string().trim().min(1).max(300),
  albumArtist: z.string().trim().min(1).max(200).optional(),
  year: z.number().int().min(1000).max(3000).nullable().optional(),
  genres: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  discNumber: z.number().int().min(1).max(100).default(1),
  trackNumber: z.number().int().min(0).max(10000).default(0),
  releaseType: z.string().trim().min(1).max(50).default('album'),
  credits: z.array(musicTrackCreditInputSchema).max(100).optional(),
  metadataLocked: z.boolean().default(true),
});

export type MusicListQueryInput = z.infer<typeof musicListQuerySchema>;
export type CreateMusicPlaylistInput = z.infer<typeof createMusicPlaylistSchema>;
export type UpdateMusicPlaylistInput = z.infer<typeof updateMusicPlaylistSchema>;
export type UpdateMusicPlaybackStateInput = z.infer<typeof updateMusicPlaybackStateSchema>;
export type UpdateMusicTrackMetadataInput = z.infer<typeof updateMusicTrackMetadataSchema>;

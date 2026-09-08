import { z } from 'zod';

export const PLAYLIST_INTENT_TARGET_DEFAULT = 50;
export const PLAYLIST_INTENT_TARGET_MIN = 10;
export const PLAYLIST_INTENT_TARGET_MAX = 100;

const intentPreferenceModeSchema = z.enum(['soft', 'hard']);
const intentLanguageProviderSchema = z
  .object({
    languages: z.array(z.string().trim().min(2).max(35)).max(8),
    excludedLanguages: z.array(z.string().trim().min(2).max(35)).max(8),
    weight: z.number().finite(),
    mode: intentPreferenceModeSchema,
  })
  .strict();
const intentLocaleProviderSchema = z
  .object({
    countries: z.array(z.string().trim().min(2).max(35)).max(8),
    scenes: z.array(z.string().trim().min(2).max(80)).max(8),
    weight: z.number().finite(),
    mode: intentPreferenceModeSchema,
  })
  .strict();
const intentWeightedNameProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    weight: z.number().finite(),
    mode: intentPreferenceModeSchema,
  })
  .strict();

/**
 * Provider-facing shape. Numeric bounds are applied after parsing so a model
 * that returns 1.2 instead of 1 cannot bypass validation or fail the request
 * unnecessarily; all strings, arrays and enums are still tightly bounded.
 */
export const playlistIntentProviderSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().min(1).max(240),
    targetCount: z.number().finite(),
    genres: z.array(intentWeightedNameProviderSchema).max(12),
    excludedGenres: z.array(z.string().trim().min(1).max(80)).max(12),
    artists: z.array(intentWeightedNameProviderSchema).max(12),
    excludedArtistNames: z.array(z.string().trim().min(1).max(200)).max(12),
    year: z
      .object({
        min: z.number().finite().nullable(),
        max: z.number().finite().nullable(),
        weight: z.number().finite(),
        mode: intentPreferenceModeSchema,
      })
      .strict(),
    language: intentLanguageProviderSchema,
    locale: intentLocaleProviderSchema,
    exploration: z.number().finite(),
    familiarity: z.number().finite(),
    favoriteBias: z.number().finite(),
    unheardBias: z.number().finite(),
    lowPlayCountBias: z.number().finite(),
    oldLibraryBias: z.number().finite(),
    recentPlayPenalty: z.number().finite(),
    artistDiversity: z.number().finite(),
    albumDiversity: z.number().finite(),
    seedMode: z.enum(['balanced', 'discovery', 'familiar']),
  })
  .strict();

const intentWeightedNameSchema = intentWeightedNameProviderSchema.extend({
  weight: z.number().min(0).max(1),
});

export const playlistIntentSchema = playlistIntentProviderSchema.extend({
  targetCount: z.number().int().min(PLAYLIST_INTENT_TARGET_MIN).max(PLAYLIST_INTENT_TARGET_MAX),
  genres: z.array(intentWeightedNameSchema).max(12),
  artists: z.array(intentWeightedNameSchema).max(12),
  year: z
    .object({
      min: z.number().int().min(1800).max(3000).nullable(),
      max: z.number().int().min(1800).max(3000).nullable(),
      weight: z.number().min(0).max(1),
      mode: intentPreferenceModeSchema,
    })
    .strict(),
  language: intentLanguageProviderSchema.extend({
    weight: z.number().min(0).max(1),
  }),
  locale: intentLocaleProviderSchema.extend({
    weight: z.number().min(0).max(1),
  }),
  exploration: z.number().min(0).max(1),
  familiarity: z.number().min(0).max(1),
  favoriteBias: z.number().min(0).max(1),
  unheardBias: z.number().min(0).max(1),
  lowPlayCountBias: z.number().min(0).max(1),
  oldLibraryBias: z.number().min(0).max(1),
  recentPlayPenalty: z.number().min(0).max(1),
  artistDiversity: z.number().min(0).max(1),
  albumDiversity: z.number().min(0).max(1),
});

export const musicAiPlaylistRequestSchema = z
  .object({
    prompt: z.string().trim().min(3).max(1000),
    generationId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._:-]{1,80}$/),
  })
  .strict();

export const musicEditorialSlotSchema = z.enum([
  'daily',
  'rediscovery',
  'comfort',
  'crossover',
  'time-capsule',
]);

export const musicEditorialPlanProviderSchema = z
  .object({
    slot: musicEditorialSlotSchema,
    intent: playlistIntentProviderSchema,
  })
  .strict();

export const musicEditorialPlansProviderSchema = z
  .object({
    plans: z.array(musicEditorialPlanProviderSchema).min(3).max(5),
  })
  .strict();

export type PlaylistIntentProviderOutput = z.infer<typeof playlistIntentProviderSchema>;
export type PlaylistIntent = z.infer<typeof playlistIntentSchema>;
export type MusicAiPlaylistRequest = z.infer<typeof musicAiPlaylistRequestSchema>;
export type MusicEditorialSlot = z.infer<typeof musicEditorialSlotSchema>;
export type MusicEditorialPlanProviderOutput = z.infer<typeof musicEditorialPlanProviderSchema>;
export type MusicEditorialPlansProviderOutput = z.infer<typeof musicEditorialPlansProviderSchema>;

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

export const addMusicPlaylistItemsSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(500),
});

export const createMusicPlaylistFromTracksSchema = createMusicPlaylistSchema.extend({
  trackIds: z.array(z.string().uuid()).min(1).max(500),
});

export const saveMusicMixSchema = createMusicPlaylistSchema.extend({
  trackIds: z.array(z.string().uuid()).min(1).max(100),
});

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

export const patchMusicPlaybackStateSchema = updateMusicPlaybackStateSchema.omit({ queue: true });

export const musicPlaybackClientQuerySchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{6,128}$/)
    .default('legacy'),
  clientName: z.string().trim().min(1).max(120).optional(),
  platform: z.enum(['web', 'ios', 'android', 'desktop', 'unknown']).default('unknown'),
});

export const createMusicHistorySchema = z.object({
  trackId: z.string().uuid(),
  listenedSeconds: z.number().finite().nonnegative(),
});

export const createMusicHistoryBatchSchema = z.object({
  events: z
    .array(
      createMusicHistorySchema.extend({
        eventId: z.string().uuid(),
        playedAt: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const musicSyncQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  version: z.coerce.number().int().min(1).max(2).default(1),
});

export const musicDownloadManifestSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(500),
  format: z.enum(['original', 'aac']).default('original'),
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
  artworkData: z.string().max(8_500_000).optional(),
  removeArtwork: z.boolean().optional(),
});

export const musicReplayGainScanSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(100),
});

export const musicFingerprintScanSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(100),
  force: z.boolean().default(false),
});

export const musicMaintenanceGenerateSchema = z.object({
  trackIds: z.array(z.string().uuid()).max(20).optional(),
  albumIds: z.array(z.string().uuid()).max(20).optional(),
  artistIds: z.array(z.string().uuid()).max(20).optional(),
});

export const musicArtistArtworkScanSchema = z.object({
  artistIds: z.array(z.string().uuid()).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

export const musicDuplicateArchiveSchema = z.object({
  keepTrackId: z.string().uuid(),
  archiveTrackId: z.string().uuid(),
  replacePlaylistItems: z.boolean().default(true),
});

export const musicReplayQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'year']).default('week'),
  year: z.coerce.number().int().min(2000).max(3000).optional(),
});

export const musicLyricsTranslationSchema = z.object({
  language: z.string().trim().min(2).max(16),
  content: z
    .string()
    .max(1024 * 1024)
    .optional(),
});

export const musicLyricsAlignSchema = z.object({
  content: z.string().max(1024 * 1024),
  leadInMs: z.number().int().min(0).max(60_000).default(1000),
  endPaddingMs: z.number().int().min(0).max(60_000).default(5000),
});

export const musicLyricsRevisionSchema = z.object({
  sourceName: z.string().trim().min(1).max(255),
  content: z
    .string()
    .min(1)
    .max(1024 * 1024),
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
  languageCode: z.string().trim().min(2).max(35).nullable().optional(),
  metadataLocked: z.boolean().default(true),
});

export const musicLanguageEnrichmentRequestSchema = z
  .object({
    maxTracks: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

export type MusicListQueryInput = z.infer<typeof musicListQuerySchema>;
export type CreateMusicPlaylistInput = z.infer<typeof createMusicPlaylistSchema>;
export type CreateMusicPlaylistFromTracksInput = z.infer<
  typeof createMusicPlaylistFromTracksSchema
>;
export type SaveMusicMixInput = z.infer<typeof saveMusicMixSchema>;
export type UpdateMusicPlaylistInput = z.infer<typeof updateMusicPlaylistSchema>;
export type UpdateMusicPlaybackStateInput = z.infer<typeof updateMusicPlaybackStateSchema>;
export type UpdateMusicTrackMetadataInput = z.infer<typeof updateMusicTrackMetadataSchema>;
export type MusicLanguageEnrichmentRequestInput = z.infer<
  typeof musicLanguageEnrichmentRequestSchema
>;

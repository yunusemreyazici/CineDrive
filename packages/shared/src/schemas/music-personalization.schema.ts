import { z } from 'zod';

export const musicSmartRuleSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    favoritesOnly: z.boolean(),
    unheardOnly: z.boolean(),
    notPlayedDays: z.number().int().min(1).max(3650).nullable().default(null),
    addedWithinDays: z.number().int().min(1).max(3650).nullable().default(null),
    genre: z.string().trim().max(80),
    language: z.enum(['', 'tr', 'en']),
    downloadedOnly: z.boolean(),
    limit: z.number().int().min(10).max(250),
  })
  .strict();

export const musicPersonalizationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    preferences: z
      .object({
        exploration: z.number().min(0).max(1),
        artistDiversity: z.number().min(0).max(1),
        recentPlayPenalty: z.number().min(0).max(1),
      })
      .strict(),
    smartLists: z.array(musicSmartRuleSchema).max(30),
    feedback: z
      .array(
        z
          .object({
            trackId: z.string().min(1).max(200),
            kind: z.enum(['more', 'hide', 'snoozeArtist']),
            expiresAt: z.string().datetime().nullable().default(null),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine(
    (value) => new Set(value.smartLists.map((rule) => rule.id)).size === value.smartLists.length,
  )
  .refine(
    (value) => new Set(value.feedback.map((item) => item.trackId)).size === value.feedback.length,
  );

export type MusicPersonalizationDto = z.infer<typeof musicPersonalizationSchema>;
export type MusicSmartRuleDto = z.infer<typeof musicSmartRuleSchema>;
export const defaultMusicPersonalization = (): MusicPersonalizationDto => ({
  revision: 0,
  preferences: { exploration: 0.5, artistDiversity: 0.5, recentPlayPenalty: 0.5 },
  smartLists: [],
  feedback: [],
});

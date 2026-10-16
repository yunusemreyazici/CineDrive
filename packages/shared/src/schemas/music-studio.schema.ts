import { z } from 'zod';

const id = z.string().min(1).max(200);
const unique = (values: string[]) => new Set(values).size === values.length;
export const refineMusicMixSchema = z
  .object({
    mixId: z.string().min(1).max(200),
    keepIds: z.array(id).max(100).refine(unique),
    generationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();
export const recordingFamilySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    trackIds: z.array(id).min(2).max(30).refine(unique),
    preferredTrackId: id,
  })
  .strict()
  .refine((v) => v.trackIds.includes(v.preferredTrackId));
export const listeningCheckpointSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    trackIds: z.array(id).min(1).max(500),
    index: z.number().int().min(0).max(499),
    position: z.number().min(0).max(86400),
    savedAt: z.iso.datetime(),
  })
  .strict()
  .refine((v) => v.index < v.trackIds.length);
export const musicStudioSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    families: z.array(recordingFamilySchema).max(200),
    sessions: z.array(listeningCheckpointSchema).max(30),
  })
  .strict()
  .refine(
    (v) =>
      unique(v.families.map((f) => f.id)) &&
      unique(v.sessions.map((s) => s.id)) &&
      unique(v.families.flatMap((f) => f.trackIds)),
  );
export type MusicStudioDto = z.infer<typeof musicStudioSchema>;
export const playlistWorkshopSchema = z
  .object({
    version: z.string().regex(/^[a-f0-9]{64}$/),
    // Keep occurrence IDs stable, including when undo restores a removed occurrence.
    items: z.array(z.object({ id: z.string().uuid(), trackId: id }).strict()).max(2000),
  })
  .strict()
  .refine((v) => unique(v.items.map((i) => i.id)));
export const playlistTransferSchema = z
  .object({
    version: z.string().regex(/^[a-f0-9]{64}$/),
    targetId: id,
    targetVersion: z.string().regex(/^[a-f0-9]{64}$/),
    itemIds: z.array(z.string().uuid()).min(1).max(500).refine(unique),
    move: z.boolean(),
  })
  .strict();
export const playlistInvitationSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(['editor', 'listener']),
  })
  .strict();

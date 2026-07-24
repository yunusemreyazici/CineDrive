import { z } from 'zod';

export const updateProgressSchema = z.object({
  mediaItemId: z.string().min(1),
  episodeId: z.string().nullable().optional(),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().min(0),
});

export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;

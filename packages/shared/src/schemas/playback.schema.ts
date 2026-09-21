import { z } from 'zod';

export const updateProgressSchema = z.object({
  mediaItemId: z.string().min(1),
  episodeId: z.string().nullable().optional(),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().min(0),
  // Wall-clock time is retained only for compatibility; it is not a safe
  // ordering authority because devices can be skewed or adjusted.
  clientInstanceId: z.string().min(1).max(128).optional(),
  clientSequence: z.number().int().nonnegative().max(2_147_483_647).optional(),
  // When present, this is the canonical server revision the client used as
  // its mutation base. A mismatch is reported as a conflict by the server.
  serverRevision: z.number().int().nonnegative().max(2_147_483_647).optional(),
  clientTimestamp: z.number().finite().optional(),
});

export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;

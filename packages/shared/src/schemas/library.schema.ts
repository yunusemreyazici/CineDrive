import { z } from 'zod';

export const createLibrarySchema = z.object({
  name: z.string().min(1),
  rootFolderId: z.string().min(1),
});

export const updateLibrarySchema = z.object({
  name: z.string().min(1).optional(),
  rootFolderId: z.string().min(1).optional(),
});

export type CreateLibraryInput = z.infer<typeof createLibrarySchema>;
export type UpdateLibraryInput = z.infer<typeof updateLibrarySchema>;

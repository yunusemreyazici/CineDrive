import { z } from 'zod';

export const createLibrarySchema = z.object({
  name: z.string().min(1, 'Kütüphane adı zorunludur.'),
  storageType: z.enum(['gdrive', 'local']).default('gdrive'),
  rootFolderId: z.string().optional().default(''),
  localFolderPath: z.string().optional(),
  googleConnectionId: z.string().optional(),
}).refine(
  (data) => {
    if (data.storageType === 'local') {
      return !!data.localFolderPath && data.localFolderPath.trim().length > 0;
    }
    return true;
  },
  {
    message: 'Yerel kütüphane için geçerli bir klasör yolu girilmelidir.',
    path: ['localFolderPath'],
  },
);

export const updateLibrarySchema = z.object({
  name: z.string().min(1).optional(),
  rootFolderId: z.string().optional(),
  localFolderPath: z.string().optional(),
});

export type CreateLibraryInput = z.infer<typeof createLibrarySchema>;
export type UpdateLibraryInput = z.infer<typeof updateLibrarySchema>;

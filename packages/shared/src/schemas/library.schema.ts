import { z } from 'zod';

export const validateLocalFolderSchema = z.object({
  localFolderPath: z.string().trim().min(1).max(4096).refine((value) => !value.includes('\0')),
});
export type ValidateLocalFolderInput = z.infer<typeof validateLocalFolderSchema>;

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
  googleConnectionId: z.string().nullable().optional(),
});

export const createDriveScanSourceSchema = z.object({
  googleConnectionId: z.string().min(1),
  rootFolderId: z.string().trim().default(''),
});

export const upsertLibraryMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['editor', 'listener']).default('listener'),
});

export type CreateLibraryInput = z.infer<typeof createLibrarySchema>;
export type UpdateLibraryInput = z.infer<typeof updateLibrarySchema>;
export type CreateDriveScanSourceInput = z.infer<typeof createDriveScanSourceSchema>;
export type UpsertLibraryMemberInput = z.infer<typeof upsertLibraryMemberSchema>;

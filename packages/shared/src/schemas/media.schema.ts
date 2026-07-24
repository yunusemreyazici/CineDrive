import { z } from 'zod';

export const mediaQuerySchema = z.object({
  type: z.enum(['movie', 'series']).optional(),
  genre: z.string().optional(),
  person: z.string().optional(),
  year: z.coerce.number().optional(),
  yearFrom: z.coerce.number().optional(),
  yearTo: z.coerce.number().optional(),
  minRating: z.coerce.number().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['title', 'year', 'voteAverage', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

export type MediaQueryInput = z.infer<typeof mediaQuerySchema>;

export const updateMediaMetadataSchema = z.object({
  title: z.string().min(1, 'Başlık boş olamaz.').optional(),
  year: z.coerce.number().nullable().optional(),
  overview: z.string().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
  backdropUrl: z.string().nullable().optional(),
  genres: z.array(z.string()).optional(),
  voteAverage: z.coerce.number().nullable().optional(),
  trailerUrl: z.string().nullable().optional(),
});

export type UpdateMediaMetadataInput = z.infer<typeof updateMediaMetadataSchema>;

export const batchDeleteMediaSchema = z.object({
  ids: z.array(z.string()).min(1, 'En az 1 içerik seçilmelidir.'),
});

export type BatchDeleteMediaInput = z.infer<typeof batchDeleteMediaSchema>;

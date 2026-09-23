import { z } from 'zod';

export const mediaQuerySchema = z.object({
  type: z.enum(['movie', 'series']).optional(),
  genre: z.string().optional(),
  person: z.string().optional(),
  year: z.coerce.number().optional(),
  yearFrom: z.coerce.number().optional(),
  yearTo: z.coerce.number().optional(),
  minRating: z.coerce.number().optional(),
  search: z.string().trim().max(200).optional(),
  hideWithoutMetadata: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional(),
  sortBy: z.enum(['title', 'year', 'voteAverage', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type MediaQueryInput = z.infer<typeof mediaQuerySchema>;

export const randomMediaQuerySchema = z.object({
  type: z.enum(['movie', 'series']).optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  compact: z.enum(['true', 'false']).optional(),
});

export type RandomMediaQueryInput = z.infer<typeof randomMediaQuerySchema>;

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

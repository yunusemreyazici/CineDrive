import { z } from 'zod';

export const mediaQuerySchema = z.object({
  type: z.enum(['movie', 'series']).optional(),
  genre: z.string().optional(),
  year: z.coerce.number().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['title', 'year', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

export type MediaQueryInput = z.infer<typeof mediaQuerySchema>;

import { normalizeGenre } from './music-discovery.service.js';

// Review hints, never assertions that a tag is wrong or input to HARD filtering.
const broadGenres = new Set([
  'pop',
  'rock',
  'rap',
  'metal',
  'jazz',
  'folk',
  'blues',
  'country',
  'classical',
  'electronic',
  'soul',
  'reggae',
  'alternative',
  'indie',
  'punk',
]);

export const maintenanceGenreReviewReasons = (track: {
  genres: string[];
  albumGenres: string[];
  metadataLocked: boolean;
}): Array<'album-only' | 'broad-unlocked' | 'different-tags'> => {
  const genres = new Set(track.genres.map(normalizeGenre).filter(Boolean));
  const albumGenres = new Set(track.albumGenres.map(normalizeGenre).filter(Boolean));
  const reasons: Array<'album-only' | 'broad-unlocked' | 'different-tags'> = [];
  if (!genres.size && albumGenres.size) reasons.push('album-only');
  if (!track.metadataLocked && genres.size === 1 && broadGenres.has([...genres][0]!))
    reasons.push('broad-unlocked');
  if (genres.size && albumGenres.size && ![...genres].some((genre) => albumGenres.has(genre)))
    reasons.push('different-tags');
  return reasons;
};

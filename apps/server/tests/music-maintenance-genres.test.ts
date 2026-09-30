import { describe, expect, it } from 'vitest';
import { maintenanceGenreReviewReasons } from '../src/services/music-maintenance-genres';

describe('non-mutating genre review hints', () => {
  it('flags a broad unlocked Pop tag without guessing artist genre or confidence', () => {
    const track = { genres: ['Pop'], albumGenres: ['pop'], metadataLocked: false };
    expect(maintenanceGenreReviewReasons(track)).toEqual(['broad-unlocked']);
    expect(track).toEqual({ genres: ['Pop'], albumGenres: ['pop'], metadataLocked: false });
    expect(maintenanceGenreReviewReasons({ ...track, metadataLocked: true })).toEqual([]);
  });
  it('distinguishes album-only evidence and differing stored tags', () => {
    expect(
      maintenanceGenreReviewReasons({ genres: [], albumGenres: ['Rock'], metadataLocked: false }),
    ).toEqual(['album-only']);
    expect(
      maintenanceGenreReviewReasons({
        genres: ['Alternative Rock'],
        albumGenres: ['Pop'],
        metadataLocked: true,
      }),
    ).toEqual(['different-tags']);
  });
  it('normalizes tags but does not flag empty or overlapping detailed tags', () => {
    expect(
      maintenanceGenreReviewReasons({
        genres: [' Alternative-Rock '],
        albumGenres: ['alternative rock', 'rock'],
        metadataLocked: false,
      }),
    ).toEqual([]);
    expect(
      maintenanceGenreReviewReasons({ genres: [], albumGenres: [], metadataLocked: false }),
    ).toEqual([]);
  });
});

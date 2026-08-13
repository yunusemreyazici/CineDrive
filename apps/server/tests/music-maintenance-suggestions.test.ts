import { describe, expect, it } from 'vitest';
import { hasMeaningfulSuggestionChange } from '../src/services/music-maintenance.service';

describe('music maintenance suggestion changes', () => {
  it('ignores internal-only fields such as albumId', () => {
    const current = {
      musicbrainzRecordingId: null,
      year: 1981,
      genres: '["Rock"]',
      credits: [],
      musicbrainzReleaseId: 'release-1',
      musicbrainzReleaseGroupId: 'group-1',
    };

    expect(
      hasMeaningfulSuggestionChange('metadata', current, {
        ...current,
        albumId: 'internal-album-id',
      }),
    ).toBe(false);
  });

  it('keeps suggestions that add a recording match or contributors', () => {
    const current = { musicbrainzRecordingId: null, credits: [] };

    expect(
      hasMeaningfulSuggestionChange('metadata', current, {
        musicbrainzRecordingId: 'recording-1',
        credits: [],
      }),
    ).toBe(true);
    expect(
      hasMeaningfulSuggestionChange('metadata', current, {
        musicbrainzRecordingId: null,
        credits: [{ name: 'Artist', role: 'composer' }],
      }),
    ).toBe(true);
  });
});

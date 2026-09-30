import { describe, expect, it, vi } from 'vitest';
import {
  loadMusicMaintenanceSummary,
  MAINTENANCE_SUMMARY_PAGE_SIZE,
  maintenanceDuplicateKey,
  maintenanceMetadataIssues,
} from '../src/services/music-maintenance-summary.service';

const track = (index: number) => ({
  id: `id-${String(index).padStart(5, '0')}`,
  title: `Song ${index}`,
  duration: 120,
  year: 2005,
  genres: '["Pop"]',
  metadataLocked: false,
  artworkId: null,
  musicbrainzRecordingId: 'recording',
  replayGainTrackDb: 0 as number | null,
  replayGainAlbumDb: null,
  primaryArtist: { name: 'Artist' },
  album: { title: 'Album', artworkId: 'album-cover' as string | null, genres: '["Pop"]' },
  fingerprint: null as {
    trackId: string;
    fingerprintHash: string | null;
    duration: number;
    status: string;
    acoustidId: string | null;
  } | null,
});

describe('catalogue-wide maintenance summary', () => {
  it('counts beyond 2000 with cross-page duplicate/fingerprint groups and bounded projections', async () => {
    const tracks = Array.from({ length: 2003 }, (_, index) => track(index));
    for (const index of [0, 400, 2002]) {
      tracks[index]!.title = 'Same title';
      tracks[index]!.fingerprint = {
        trackId: tracks[index]!.id,
        fingerprintHash: 'hash',
        duration: 120,
        status: index === 2002 ? 'failed' : 'analyzed',
        acoustidId: index === 400 ? 'identified' : null,
      };
    }
    tracks[2001]!.genres = 'invalid';
    tracks[2001]!.album.artworkId = null;
    tracks[2001]!.replayGainTrackDb = null;
    const findMany = vi.fn();
    for (let offset = 0; offset < tracks.length; offset += MAINTENANCE_SUMMARY_PAGE_SIZE)
      findMany.mockResolvedValueOnce(tracks.slice(offset, offset + MAINTENANCE_SUMMARY_PAGE_SIZE));
    const where = { library: { userId: 'owner' }, driveFile: { status: 'active' } };
    const result = await loadMusicMaintenanceSummary(
      { musicTrack: { findMany } } as never,
      where,
      new Set([tracks[0]!.id]),
    );
    expect(result.catalogueTracks).toBe(2003);
    expect(result.genreReviewTracks).toBe(2003);
    expect(result.totals).toEqual({
      missingArtwork: 1,
      missingMetadata: 1,
      replayGainMissing: 1,
      duplicates: 1,
      acousticDuplicates: 1,
    });
    expect(result.fingerprints).toEqual({ total: 3, analyzed: 2, identified: 1, failed: 1 });
    expect(result.previewFingerprints).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(6);
    for (const [args] of findMany.mock.calls) {
      expect(args.take).toBe(400);
      expect(args.orderBy).toEqual({ id: 'asc' });
      expect(args.select).not.toHaveProperty('history');
      expect(args.select).not.toHaveProperty('driveFile');
      expect(args.select.fingerprint.select).not.toHaveProperty('fingerprint');
    }
    expect(findMany.mock.calls[0]![0].where).toEqual(where);
    expect(findMany.mock.calls[1]![0].where).toEqual({
      AND: [where, { id: { gt: tracks[399]!.id } }],
    });
  });

  it('handles an empty catalogue', async () => {
    const result = await loadMusicMaintenanceSummary(
      {
        musicTrack: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
      {},
      new Set(),
    );
    expect(result.catalogueTracks).toBe(0);
    expect(result.previewFingerprints).toEqual([]);
    expect(Object.values(result.totals).every((count) => count === 0)).toBe(true);
  });

  it('finishes an exact-sized page using a guarded subsequent page', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 400 }, (_, index) => track(index)))
      .mockResolvedValueOnce([]);
    const result = await loadMusicMaintenanceSummary(
      { musicTrack: { findMany } } as never,
      { libraryId: 'allowed' },
      new Set(),
    );
    expect(result.catalogueTracks).toBe(400);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps issue and duplicate-key semantics consistent with preview formatting', () => {
    expect(
      maintenanceMetadataIssues({
        primaryArtist: { name: 'Unknown Artist' },
        album: null,
        year: null,
        genres: [],
        musicbrainzRecordingId: null,
      }),
    ).toEqual(['artist', 'album', 'year', 'genres', 'musicbrainz']);
    expect(maintenanceDuplicateKey({ ...track(0), title: 'Şarkı!', duration: 121 })).toBe(
      'sark|artist|122',
    );
    expect(maintenanceMetadataIssues({ ...track(0), genres: ['Pop'] })).toEqual([]);
  });
});

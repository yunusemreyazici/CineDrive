import { describe, expect, it, vi } from 'vitest';
import { MusicMaintenanceService } from '../src/services/music-maintenance.service';
import type { MusicBrainzService } from '../src/services/musicbrainz.service';

const artist = {
  id: 'artist-1',
  userId: 'user-1',
  name: 'Unresolved Artist',
  normalizedName: 'unresolved artist',
  sortName: null,
  musicbrainzId: 'mbid-1',
  artworkId: null,
  artworkSource: null,
  artworkSourceUrl: null,
  artworkAttribution: null,
  artworkLicense: null,
  artworkLocked: false,
  artworkLookupStatus: 'pending',
  artworkLookupAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MusicMaintenanceService artist artwork scan', () => {
  it('rotates through missing artists by their oldest lookup time', async () => {
    const findMany = vi.fn().mockResolvedValue([artist]);
    const update = vi.fn().mockResolvedValue(artist);
    const service = new MusicMaintenanceService({
      musicArtist: { findMany, update },
    } as never);
    const internals = service as unknown as { musicbrainz: MusicBrainzService };
    vi.spyOn(internals.musicbrainz, 'enrichArtistArtwork').mockResolvedValue(null);

    const result = await service.scanArtistArtwork('user-1', { limit: 12 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ artworkLookupAt: 'asc' }, { name: 'asc' }],
        take: 12,
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: artist.id },
      data: {
        artworkLookupStatus: 'not-found',
        artworkLookupAt: expect.any(Date),
      },
    });
    expect(result).toMatchObject({ scanned: 1, found: 0, notFound: 1, failed: 0 });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicBrainzService } from '../src/services/musicbrainz.service';
import { findOnlineLyrics } from '../src/services/music-lyrics.service';

afterEach(() => vi.restoreAllMocks());

describe('Bounded provider caches', () => {
  it('reuses a lyrics result and preserves the 12-hour positive TTL with mocked HTTP only', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const input = {
      trackId: 'cache-test',
      title: 'Cache Fixture Positive',
      artist: 'Fixture Artist',
      album: 'Fixture Album',
      duration: 123,
    };
    const result = {
      id: 123,
      trackName: input.title,
      artistName: input.artist,
      albumName: input.album,
      duration: 123,
      instrumental: false,
      plainLyrics: 'fixture text',
      syncedLyrics: null,
    };
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(result));
    expect(await findOnlineLyrics(input)).toEqual(result);
    now += 12 * 60 * 60 * 1000 - 1;
    expect(await findOnlineLyrics(input)).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1;
    await findOnlineLyrics(input);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses not-found lyrics for 15 minutes, then permits another provider lookup', async () => {
    let now = Date.now() + 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).includes('/get?') ? new Response(null, { status: 404 }) : Response.json([]),
      );
    const input = {
      trackId: 'missing-cache-test',
      title: 'Cache Fixture Missing',
      artist: 'Fixture Artist',
      album: 'Fixture Album',
      duration: 123,
    };
    expect(await findOnlineLyrics(input)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    now += 15 * 60 * 1000 - 1;
    expect(await findOnlineLyrics(input)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    now += 1;
    expect(await findOnlineLyrics(input)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('bounds retained album artwork bytes without serializing image buffers', async () => {
    const service = new MusicBrainzService();
    const artwork = Buffer.alloc(2 * 1024 * 1024);
    const fetchAlbum = vi
      .spyOn(service as unknown as { fetchAlbum: () => Promise<unknown> }, 'fetchAlbum')
      .mockResolvedValue({
        releaseGroupId: 'fixture',
        genres: [],
        secondaryTypes: [],
        artwork: { mimeType: 'image/jpeg', data: artwork },
      });
    const http = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected external request'));
    for (let index = 0; index < 10; index += 1) await service.enrichAlbum('Fixture', String(index));
    await service.enrichAlbum('Fixture', '9');
    expect(fetchAlbum).toHaveBeenCalledTimes(10);
    await service.enrichAlbum('Fixture', '0');
    expect(fetchAlbum).toHaveBeenCalledTimes(11);
    expect(http).not.toHaveBeenCalled();
  });
});

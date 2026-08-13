import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicBrainzService } from '../src/services/musicbrainz.service';

describe('MusicBrainz artist artwork', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves MusicBrainz to Wikidata P18 and downloads Commons artwork', async () => {
    const image = Buffer.from('artist-image');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            relations: [
              {
                type: 'wikidata',
                url: { resource: 'https://www.wikidata.org/wiki/Q123' },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q123: {
                claims: {
                  P18: [
                    {
                      rank: 'preferred',
                      mainsnak: { datavalue: { value: 'Artist portrait.jpg' } },
                    },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                1: {
                  imageinfo: [
                    {
                      thumburl: 'https://upload.wikimedia.org/artist.jpg',
                      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Artist_portrait.jpg',
                      mime: 'image/jpeg',
                      extmetadata: {
                        Artist: { value: '<b>Jane Photographer</b>' },
                        LicenseShortName: { value: 'CC BY-SA 4.0' },
                      },
                    },
                  ],
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(image, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );

    const result = await new MusicBrainzService().enrichArtistArtwork('artist-mbid');

    expect(result).toMatchObject({
      musicbrainzId: 'artist-mbid',
      wikidataId: 'Q123',
      previewUrl: 'https://upload.wikimedia.org/artist.jpg',
      attribution: 'Jane Photographer',
      license: 'CC BY-SA 4.0',
      artwork: { mimeType: 'image/jpeg' },
    });
    expect(result?.artwork.data).toEqual(image);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('matches a unique artist only when MusicBrainz returns an exact score-100 name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artists: [
            {
              id: '05ca8423-760a-4687-a57e-10cb590dfc86',
              name: 'Münir Nurettin Selçuk',
              'sort-name': 'Selçuk, Münir Nurettin',
              type: 'Person',
              score: 100,
            },
            { id: 'wrong-id', name: 'Münir Selçuk', score: 87 },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      new MusicBrainzService().matchArtistIdentity('Münir Nurettin Selçuk'),
    ).resolves.toMatchObject({
      musicbrainzId: '05ca8423-760a-4687-a57e-10cb590dfc86',
      sortName: 'Selçuk, Münir Nurettin',
      confidence: 100,
    });
  });

  it('rejects ambiguous exact-name artist matches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artists: [
            { id: 'first-id', name: 'The Band', score: 100 },
            { id: 'second-id', name: 'The Band', score: 100 },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(new MusicBrainzService().matchArtistIdentity('The Band')).resolves.toBeNull();
  });
});

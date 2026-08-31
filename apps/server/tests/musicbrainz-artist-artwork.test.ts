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
                        Artist: {
                          value: '<b>Jane Photographer</b><script><script>hidden</script></script>',
                        },
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

  it('falls back to an exact Deezer artist match when Wikimedia has no image', async () => {
    const image = Buffer.from('deezer-artist-image');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'BLOK3', relations: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ query: { search: [] } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 117259882,
                name: 'BLOK3',
                picture_xl: 'https://cdn-images.dzcdn.net/images/artist/example/1000x1000.jpg',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(image, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );

    await expect(
      new MusicBrainzService().findArtistArtwork({
        musicbrainzId: 'blok3-mbid',
        artistName: 'BLOK3',
      }),
    ).resolves.toMatchObject({
      source: 'deezer',
      sourceUrl: 'https://www.deezer.com/artist/117259882',
      attribution: 'Deezer · BLOK3',
      artwork: { mimeType: 'image/jpeg', data: image },
    });
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

  it('finds Wikidata by the exact MusicBrainz ID when the relation is missing', async () => {
    const image = Buffer.from('reverse-linked-image');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ relations: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ query: { search: [{ title: 'Q456' }] } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q456: {
                claims: {
                  P18: [{ mainsnak: { datavalue: { value: 'Reverse portrait.jpg' } } }],
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
                      thumburl: 'https://upload.wikimedia.org/reverse.jpg',
                      descriptionurl:
                        'https://commons.wikimedia.org/wiki/File:Reverse_portrait.jpg',
                      mime: 'image/jpeg',
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

    await expect(
      new MusicBrainzService().enrichArtistArtwork('artist-mbid'),
    ).resolves.toMatchObject({
      wikidataId: 'Q456',
      previewUrl: 'https://upload.wikimedia.org/reverse.jpg',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('haswbstatement%3AP434%3Dartist-mbid');
  });

  it('uses a free Wikipedia page image when Wikidata has no portrait', async () => {
    const image = Buffer.from('wikipedia-page-image');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            relations: [
              { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q789' } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q789: {
                claims: {},
                sitelinks: {
                  trwiki: {
                    site: 'trwiki',
                    title: 'Örnek sanatçı',
                    url: 'https://tr.wikipedia.org/wiki/%C3%96rnek_sanat%C3%A7%C4%B1',
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ query: { pages: { 1: { pageimage: 'Concert photo.jpg' } } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            query: {
              pages: {
                2: {
                  imageinfo: [
                    {
                      thumburl: 'https://upload.wikimedia.org/concert.jpg',
                      descriptionurl: 'https://tr.wikipedia.org/wiki/Dosya:Concert_photo.jpg',
                      mime: 'image/jpeg',
                      extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } },
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

    await expect(
      new MusicBrainzService().enrichArtistArtwork('artist-mbid'),
    ).resolves.toMatchObject({
      wikidataId: 'Q789',
      previewUrl: 'https://upload.wikimedia.org/concert.jpg',
      license: 'CC BY 4.0',
    });
  });

  it('falls back to a Wikidata logo when no portrait or page image exists', async () => {
    const image = Buffer.from('artist-logo');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            relations: [
              { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q999' } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entities: {
              Q999: {
                claims: {
                  P154: [{ mainsnak: { datavalue: { value: 'Artist logo.svg' } } }],
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
                      thumburl: 'https://upload.wikimedia.org/logo.png',
                      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Artist_logo.svg',
                      mime: 'image/svg+xml',
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
        new Response(image, { status: 200, headers: { 'content-type': 'image/png' } }),
      );

    await expect(
      new MusicBrainzService().enrichArtistArtwork('artist-mbid'),
    ).resolves.toMatchObject({
      wikidataId: 'Q999',
      previewUrl: 'https://upload.wikimedia.org/logo.png',
      artwork: { mimeType: 'image/png' },
    });
  });
});

import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { findMusicTracksByIdsWithRelations } from '../utils/music-format.js';

const SEARCH_LIMITS = { tracks: 8, albums: 6, artists: 6 };

// Same canonical keys as the existing index/import and metadata-edit paths.
// This changes ordering, not the legacy substring matching/Unicode coverage.
const indexKey = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const collectMusicSearchIds = async <T>(
  tiers: T[],
  limit: number,
  load: (tier: T, remaining: number, excludedIds: string[]) => Promise<Array<{ id: string }>>,
): Promise<string[]> => {
  const ids: string[] = [];
  for (const tier of tiers) {
    if (ids.length >= limit) break;
    const rows = await load(tier, limit - ids.length, [...ids]);
    for (const row of rows) if (!ids.includes(row.id) && ids.length < limit) ids.push(row.id);
  }
  return ids;
};

/** Apply the shared access predicate at every tier and again during hydration.
 * Select small ID lists before any graphs; album-only matches cannot consume
 * the track limit before a requested title is searched. No catalogue-wide
 * materialization/hydration; legacy substring SQL predicates remain unchanged.
 */
export const searchMusic = async (
  prisma: PrismaClient,
  userId: string,
  trackWhere: Prisma.MusicTrackWhereInput,
  query: string,
) => {
  const canonicalKey = indexKey(query);
  const trackTiers: Prisma.MusicTrackWhereInput[] = [
    { title: query },
    {
      AND: [
        { title: { contains: query } },
        { OR: [{ title: query }, ...(canonicalKey ? [{ normalizedTitle: canonicalKey }] : [])] },
      ],
    },
    { title: { startsWith: query } },
    { title: { contains: query } },
    { primaryArtist: { name: { contains: query } } },
    { album: { title: { contains: query } } },
  ];
  const albumScope: Prisma.MusicAlbumWhereInput = { tracks: { some: trackWhere } };
  const artistScope: Prisma.MusicArtistWhereInput = {
    trackCredits: { some: { track: trackWhere } },
  };
  const albumTiers: Prisma.MusicAlbumWhereInput[] = [
    { title: query },
    {
      AND: [
        { title: { contains: query } },
        { OR: [{ title: query }, ...(canonicalKey ? [{ normalizedTitle: canonicalKey }] : [])] },
      ],
    },
    { title: { startsWith: query } },
    { title: { contains: query } },
    { artist: { name: { contains: query } } },
  ];
  const artistTiers: Prisma.MusicArtistWhereInput[] = [
    { name: query },
    {
      AND: [
        { name: { contains: query } },
        { OR: [{ name: query }, ...(canonicalKey ? [{ normalizedName: canonicalKey }] : [])] },
      ],
    },
    { name: { startsWith: query } },
    { name: { contains: query } },
  ];
  const [trackIds, albumIds, artistIds] = await Promise.all([
    collectMusicSearchIds(trackTiers, SEARCH_LIMITS.tracks, (tier, take, excludedIds) =>
      prisma.musicTrack.findMany({
        where: { AND: [trackWhere, tier, { id: { notIn: excludedIds } }] },
        select: { id: true },
        take,
        orderBy: [{ normalizedTitle: 'asc' }, { id: 'asc' }],
      }),
    ),
    collectMusicSearchIds(albumTiers, SEARCH_LIMITS.albums, (tier, take, excludedIds) =>
      prisma.musicAlbum.findMany({
        where: { AND: [albumScope, tier, { id: { notIn: excludedIds } }] },
        select: { id: true },
        take,
        orderBy: [{ normalizedTitle: 'asc' }, { id: 'asc' }],
      }),
    ),
    collectMusicSearchIds(artistTiers, SEARCH_LIMITS.artists, (tier, take, excludedIds) =>
      prisma.musicArtist.findMany({
        where: { AND: [artistScope, tier, { id: { notIn: excludedIds } }] },
        select: { id: true },
        take,
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      }),
    ),
  ]);
  const [tracks, albums, artists] = await Promise.all([
    findMusicTracksByIdsWithRelations(prisma, userId, trackIds, trackWhere),
    albumIds.length
      ? prisma.musicAlbum.findMany({
          where: { AND: [albumScope, { id: { in: albumIds } }] },
          include: {
            artwork: { select: { id: true } },
            artist: true,
            _count: { select: { tracks: { where: trackWhere } } },
          },
        })
      : [],
    artistIds.length
      ? prisma.musicArtist.findMany({
          where: { AND: [artistScope, { id: { in: artistIds } }] },
          include: {
            artwork: { select: { id: true } },
            _count: {
              select: {
                albums: { where: { tracks: { some: trackWhere } } },
                trackCredits: { where: { track: trackWhere } },
              },
            },
          },
        })
      : [],
  ]);
  const albumById = new Map(albums.map((album) => [album.id, album]));
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  return {
    tracks,
    albums: albumIds.flatMap((id) => albumById.get(id) || []),
    artists: artistIds.flatMap((id) => artistById.get(id) || []),
  };
};

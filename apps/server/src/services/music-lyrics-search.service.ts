import type { PrismaClient } from '@cinedrive/prisma';
import { Prisma } from '../generated/prisma/client.js';
import { accessibleLibraryFilter, readableMusicTrackFilter } from '../utils/library-access.js';
import { findMusicTracksByIdsWithRelations } from '../utils/music-format.js';
import {
  lyricsExcerpt,
  lyricsSearchExpression,
  normalizeLyricsSearch,
} from '../utils/music-lyrics-search.js';
import { parseLrc } from './music-lyrics.service.js';
import { collectMusicSearchIds } from './music-search.service.js';

/** Resumable, provider-free startup backfill. At most ten original lyrics blobs
 * are resident per batch; compare content to avoid overwriting a concurrent edit.
 */
export const backfillLyricsSearch = async (prisma: PrismaClient): Promise<void> => {
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.musicLyrics.findMany({
      where: { searchText: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, content: true },
      orderBy: { id: 'asc' },
      take: 10,
    });
    if (!rows.length) return;
    const documents = rows.map((row) => ({
      ...row,
      searchText: normalizeLyricsSearch(
        parseLrc(row.content)
          .lines.map((line) => line.text)
          .join('\n'),
      ),
    }));
    await prisma.$transaction(async (tx) => {
      for (const row of documents) {
        // Only derived text changes: bypass Prisma's @updatedAt so an index
        // backfill does not masquerade as a lyrics edit or invalidate its cache.
        await tx.$executeRaw`UPDATE MusicLyrics SET searchText = ${row.searchText}
          WHERE id = ${row.id} AND content = ${row.content} AND searchText IS NULL`;
      }
    });
    cursor = rows.at(-1)!.id;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

export const searchLyrics = async (prisma: PrismaClient, userId: string, query: string) => {
  const expression = lyricsSearchExpression(query);
  if (!expression) return [];
  const libraries = await prisma.library.findMany({
    where: accessibleLibraryFilter(userId),
    select: { id: true },
  });
  if (!libraries.length) return [];
  const phrase = normalizeLyricsSearch(query);
  // Permission and active-file predicates run BEFORE rank/limit, so unrelated
  // matches cannot consume the result budget or leak excerpts. Parameterized SQL.
  // Prefer a complete phrase via FTS itself, then fill with literal word-prefix
  // matches. No instr/LIKE scan of every matched lyrics blob to rank the phrase.
  const ids = await collectMusicSearchIds(
    [`"${phrase}"`, expression],
    8,
    (match, take, excludedIds) =>
      prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT t.id FROM MusicLyricsSearch
      JOIN MusicLyrics l ON l.rowid = MusicLyricsSearch.rowid
      JOIN MusicTrack t ON t.id = l.trackId
      JOIN DriveFile f ON f.id = t.driveFileId
      WHERE MusicLyricsSearch MATCH ${match}
        AND t.libraryId IN (${Prisma.join(libraries.map((library) => library.id))})
        AND f.status = 'active'
        ${excludedIds.length ? Prisma.sql`AND t.id NOT IN (${Prisma.join(excludedIds)})` : Prisma.empty}
      ORDER BY bm25(MusicLyricsSearch), t.id
      LIMIT ${take}
    `),
  );
  if (!ids.length) return [];
  const scope = readableMusicTrackFilter(userId);
  const [tracks, lyrics] = await Promise.all([
    findMusicTracksByIdsWithRelations(prisma, userId, ids, scope),
    prisma.musicLyrics.findMany({
      where: { trackId: { in: ids }, track: scope },
      select: { trackId: true, content: true },
    }),
  ]);
  const excerpts = new Map(
    lyrics.flatMap((lyric): Array<[string, string]> => {
      const lines = parseLrc(lyric.content).lines.map((line) => line.text);
      const words = normalizeLyricsSearch(lines.join(' ')).split(' ');
      // Lyrics may be edited between MATCH and hydration. Do not publish a
      // stale index hit against replacement words that no longer match.
      if (!phrase.split(' ').every((token) => words.some((word) => word.startsWith(token))))
        return [];
      return [[lyric.trackId, lyricsExcerpt(lines, query)]];
    }),
  );
  return tracks.flatMap((track) => {
    const excerpt = excerpts.get(track.id);
    return excerpt ? [{ track, excerpt }] : [];
  });
};

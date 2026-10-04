import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import { parseGenres } from '../utils/music-format.js';
import { maintenanceGenreReviewReasons } from './music-maintenance-genres.js';

export const MAINTENANCE_SUMMARY_PAGE_SIZE = 400;

export const maintenanceMetadataIssues = (track: {
  primaryArtist: { name: string } | null;
  album: { title: string } | null;
  year: number | null;
  genres: string[];
  musicbrainzRecordingId: string | null;
}): string[] => {
  const issues: string[] = [];
  if (!track.primaryArtist || /^bilinmeyen|^unknown/i.test(track.primaryArtist.name))
    issues.push('artist');
  if (!track.album || /^bilinmeyen|^unknown/i.test(track.album.title)) issues.push('album');
  if (!track.year) issues.push('year');
  if (!track.genres.length) issues.push('genres');
  if (!track.musicbrainzRecordingId) issues.push('musicbrainz');
  return issues;
};

export const maintenanceDuplicateKey = (track: {
  title: string;
  primaryArtist: { name: string } | null;
  duration: number | null;
}) => {
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${normalize(track.title)}|${normalize(track.primaryArtist?.name || '')}|${Math.round((track.duration || 0) / 2) * 2}`;
};

/** Counts the accessible active catalogue, never hydration graphs or fingerprint payloads.
 * Keys/counts are retained for cross-page groups; only preview fingerprints retain IDs.
 * This is a live read, not a transactionally frozen snapshot of a concurrently changing library.
 */
export const loadMusicMaintenanceSummary = async (
  prisma: PrismaClient,
  where: Prisma.MusicTrackWhereInput,
  previewIds: ReadonlySet<string>,
) => {
  let cursor: string | undefined;
  let catalogueTracks = 0;
  let genreReviewTracks = 0;
  const totals = {
    missingArtwork: 0,
    missingMetadata: 0,
    replayGainMissing: 0,
    duplicates: 0,
    acousticDuplicates: 0,
  };
  const fingerprints = { total: 0, analyzed: 0, identified: 0, failed: 0 };
  const previewFingerprints: Array<{
    trackId: string;
    fingerprintHash: string | null;
    duration: number | null;
    status: string;
  }> = [];
  const duplicates = new Map<string, number>();
  const acoustic = new Map<string, number>();
  const incrementGroup = (groups: Map<string, number>, key: string): boolean => {
    const count = (groups.get(key) || 0) + 1;
    groups.set(key, count);
    return count === 2;
  };

  while (true) {
    const page = await prisma.musicTrack.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      orderBy: { id: 'asc' },
      take: MAINTENANCE_SUMMARY_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        duration: true,
        year: true,
        genres: true,
        artworkId: true,
        musicbrainzRecordingId: true,
        metadataLocked: true,
        replayGainTrackDb: true,
        replayGainAlbumDb: true,
        primaryArtist: { select: { name: true } },
        album: { select: { title: true, artworkId: true, genres: true } },
        fingerprint: {
          select: {
            trackId: true,
            fingerprintHash: true,
            duration: true,
            status: true,
            acoustidId: true,
          },
        },
      },
    });
    for (const track of page) {
      catalogueTracks += 1;
      if (
        maintenanceGenreReviewReasons({
          genres: parseGenres(track.genres),
          albumGenres: parseGenres(track.album?.genres),
          metadataLocked: track.metadataLocked,
        }).length
      )
        genreReviewTracks += 1;
      if (!track.artworkId && !track.album?.artworkId) totals.missingArtwork += 1;
      if (maintenanceMetadataIssues({ ...track, genres: parseGenres(track.genres) }).length)
        totals.missingMetadata += 1;
      if (track.replayGainTrackDb == null && track.replayGainAlbumDb == null)
        totals.replayGainMissing += 1;
      if (incrementGroup(duplicates, maintenanceDuplicateKey(track))) totals.duplicates += 1;
      const fingerprint = track.fingerprint;
      if (!fingerprint) continue;
      fingerprints.total += 1;
      if (fingerprint.status === 'analyzed') fingerprints.analyzed += 1;
      if (fingerprint.status === 'failed') fingerprints.failed += 1;
      if (fingerprint.acoustidId) fingerprints.identified += 1;
      if (
        fingerprint.fingerprintHash &&
        incrementGroup(
          acoustic,
          `${fingerprint.fingerprintHash}|${Math.round(fingerprint.duration || 0)}`,
        )
      )
        totals.acousticDuplicates += 1;
      if (previewIds.has(track.id)) previewFingerprints.push(fingerprint);
    }
    if (page.length < MAINTENANCE_SUMMARY_PAGE_SIZE) break;
    cursor = page[page.length - 1]!.id;
  }
  return { catalogueTracks, totals, fingerprints, previewFingerprints, genreReviewTracks };
};

import type { PrismaClient } from '@cinedrive/prisma';
import type { MusicStudioDto, PlaylistRecommendationsDto } from '@cinedrive/shared';
import { loadDiscoveryCandidates, type DiscoveryCandidate } from './music-discovery-candidates.js';
import { normalizeGenre } from './music-discovery.service.js';
import { selectDiscoveryCandidates } from './music-discovery-selection.js';
import { readStudio, readWorkshop, StudioError } from './music-studio.service.js';
import { findMusicTracksByIdsWithRelations, formatMusicTrack } from '../utils/music-format.js';
import { readableMusicTrackFilter } from '../utils/library-access.js';

// Conservative metadata fallback: only recognized version suffixes, never arbitrary subtitles.
export function recordingKey(track: DiscoveryCandidate): string {
  const title = track.title.replace(
    /\s*(?:[-–—]\s*|[([])(?:(?:\d{4}\s+)?remaster(?:ed)?|live|acoustic|radio edit|album version)\b.*$/iu,
    '',
  );
  const artist = normalizeGenre(track.artistName || '');
  return artist && title.trim() ? `${artist}:${normalizeGenre(title)}` : `id:${track.id}`;
}

/** All exclusions happen before the shared selector; its diversity relaxation cannot undo them. */
export function recommendPlaylistCandidates(
  candidates: DiscoveryCandidate[],
  memberIds: string[],
  studio: MusicStudioDto,
  seed: string,
  excludeIds: string[] = [],
): DiscoveryCandidate[] {
  const parents = new Map<string, string>();
  const root = (id: string): string => {
    let current = id;
    while (parents.has(current)) current = parents.get(current)!;
    let next = id;
    while (parents.has(next)) {
      const previous = parents.get(next)!;
      parents.set(next, current);
      next = previous;
    }
    return current;
  };
  const join = (a: string, b: string) => {
    const left = root(a),
      right = root(b);
    if (left !== right) parents.set(left, right);
  };
  const keys = new Map<string, string>();
  for (const track of candidates) {
    for (const key of [
      recordingKey(track),
      ...(track.musicbrainzRecordingId ? [`mb:${track.musicbrainzRecordingId}`] : []),
    ]) {
      const previous = keys.get(key);
      if (previous) join(previous, track.id);
      else keys.set(key, track.id);
    }
  }
  for (const family of studio.families)
    for (const id of family.trackIds) join(id, family.preferredTrackId);
  const excluded = new Set([...memberIds, ...excludeIds].map(root));
  const memberSet = new Set(memberIds);
  const anchors = candidates.filter((t) => memberSet.has(t.id));
  // No invented playlist affinity if every member is unavailable (or the list is empty).
  if (!anchors.length) return [];
  const genres = new Set(
    anchors.flatMap((t) => [...t.genres, ...t.albumGenres].map(normalizeGenre)),
  );
  genres.delete('');
  const artists = new Set(anchors.map((t) => t.artistId).filter(Boolean));
  const years = anchors.map((t) => t.year ?? t.albumYear).filter((y): y is number => y !== null);
  const averageYear = years.length ? years.reduce((a, b) => a + b, 0) / years.length : null;
  const preferred = new Set(studio.families.map((f) => f.preferredTrackId));
  const unique = new Map<string, DiscoveryCandidate>();
  for (const track of candidates) {
    const key = root(track.id);
    if (excluded.has(key)) continue;
    if (!unique.has(key) || preferred.has(track.id)) unique.set(key, track);
  }
  const related = [...unique.values()].filter(
    (track) =>
      (track.artistId && artists.has(track.artistId)) ||
      [...track.genres, ...track.albumGenres].some((g) => genres.has(normalizeGenre(g))),
  );
  // Do not pad a well-defined rock list with unrelated music merely to reach eight.
  const pool = related.length ? related : [...unique.values()];
  return selectDiscoveryCandidates(
    pool
      .map((track) => {
        const genre = [...track.genres, ...track.albumGenres].some((g) =>
          genres.has(normalizeGenre(g)),
        )
          ? 1
          : 0;
        const artist = track.artistId && artists.has(track.artistId) ? 1 : 0;
        const year = track.year ?? track.albumYear;
        const era = year && averageYear ? Math.max(0, 1 - Math.abs(year - averageYear) / 20) : 0;
        const affinity = genre * 5 + artist * 3 + era;
        return {
          value: track,
          affinity,
          id: track.id,
          artistKey: track.artistId || track.artistName || track.id,
          albumKey: track.albumId || track.id,
          relevance: affinity + (track.isFavorite ? 1 : 0),
          exploration: affinity + 2 / (1 + track.playCount),
        };
      })
      .filter((t) => t.affinity > 0),
    seed,
    8,
    undefined,
    { artistLimit: 2, albumLimit: 1 },
  );
}

export async function playlistRecommendations(
  db: PrismaClient,
  userId: string,
  playlistId: string,
  generationId: string,
  excludeIds: string[],
): Promise<PlaylistRecommendationsDto> {
  // Authorize before loading any catalogue metadata, including accepted listeners.
  const snapshot = await readWorkshop(db, userId, playlistId);
  const [candidates, studio] = await Promise.all([
    loadDiscoveryCandidates(db, userId, snapshot.playlist.userId),
    readStudio(db, userId),
  ]);
  const selected = recommendPlaylistCandidates(
    candidates,
    snapshot.playlist.items.map((i) => i.trackId),
    studio,
    `${userId}:${playlistId}:${snapshot.version}:${generationId}`,
    excludeIds,
  );
  const rows = await findMusicTracksByIdsWithRelations(
    db,
    userId,
    selected.map((t) => t.id),
    readableMusicTrackFilter(userId),
  );
  const current = await readWorkshop(db, userId, playlistId);
  if (current.version !== snapshot.version)
    throw new StudioError(409, 'Playlist changed. Reload recommendations.');
  const byId = new Map(rows.map((t) => [t.id, formatMusicTrack(t)]));
  const memberIds = new Set(snapshot.playlist.items.map((i) => i.trackId));
  const anchors = candidates.filter((t) => memberIds.has(t.id));
  return {
    version: snapshot.version,
    tracks: selected.flatMap((t) => (byId.has(t.id) ? [byId.get(t.id)!] : [])),
    reasons: Object.fromEntries(
      selected.filter((t) => byId.has(t.id)).map((t) => [t.id, recommendationReasons(t, anchors)]),
    ),
  };
}

export function recommendationReasons(
  track: DiscoveryCandidate,
  anchors: DiscoveryCandidate[],
): NonNullable<PlaylistRecommendationsDto['reasons']>[string] {
  const reasons: NonNullable<PlaylistRecommendationsDto['reasons']>[string] = [];
  const genres = new Set(
    anchors.flatMap((t) => [...t.genres, ...t.albumGenres].map(normalizeGenre)),
  );
  const genre = [...track.genres, ...track.albumGenres]
    .map(normalizeGenre)
    .find((g) => g && genres.has(g));
  if (genre) reasons.push({ kind: 'genre', value: genre });
  if (track.artistId && track.artistName && anchors.some((t) => t.artistId === track.artistId))
    reasons.push({ kind: 'artist', value: track.artistName });
  const year = track.year ?? track.albumYear;
  const years = anchors.map((t) => t.year ?? t.albumYear).filter((y): y is number => y !== null);
  if (year && years.length && Math.abs(year - years.reduce((a, b) => a + b, 0) / years.length) <= 5)
    reasons.push({ kind: 'era', value: String(year) });
  return reasons;
}

import type { PrismaClient } from '@cinedrive/prisma';
import {
  defaultMusicPersonalization,
  musicPersonalizationSchema,
  type MusicPersonalizationDto,
  type MusicSmartRuleDto,
} from '@cinedrive/shared';
import type { DiscoveryCandidate } from './music-discovery-candidates.js';

export function parseMusicPersonalization(raw: string): MusicPersonalizationDto {
  try {
    return musicPersonalizationSchema.parse(JSON.parse(raw));
  } catch {
    return defaultMusicPersonalization();
  }
}
export async function readMusicPersonalization(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { musicPersonalization: true },
  });
  return {
    raw: user.musicPersonalization,
    value: parseMusicPersonalization(user.musicPersonalization),
  };
}
const normalized = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i').trim();
const genres = (candidate: DiscoveryCandidate) =>
  [...candidate.genres, ...candidate.albumGenres].map(normalized);

export function personalizationSignals(
  candidates: DiscoveryCandidate[],
  profile: MusicPersonalizationDto,
  now = Date.now(),
) {
  const byId = new Map(candidates.map((track) => [track.id, track]));
  const hidden = new Set<string>();
  const mutedArtists = new Set<string>();
  const likedArtists = new Set<string>();
  const likedGenres = new Set<string>();
  for (const item of profile.feedback) {
    if (item.expiresAt && Date.parse(item.expiresAt) <= now) continue;
    const track = byId.get(item.trackId);
    if (!track) continue;
    if (item.kind === 'hide') hidden.add(track.id);
    if (item.kind === 'snoozeArtist' && track.artistId) mutedArtists.add(track.artistId);
    if (item.kind === 'more') {
      if (track.artistId) likedArtists.add(track.artistId);
      for (const genre of genres(track)) likedGenres.add(genre);
    }
  }
  return {
    allowed: (track: DiscoveryCandidate) =>
      !hidden.has(track.id) && !(track.artistId && mutedArtists.has(track.artistId)),
    boost: (track: DiscoveryCandidate) =>
      (track.artistId && likedArtists.has(track.artistId) ? 18 : 0) +
      (genres(track).some((genre) => likedGenres.has(genre)) ? 8 : 0),
  };
}

export function matchesSmartRule(
  track: DiscoveryCandidate,
  rule: MusicSmartRuleDto,
  lastPlayedAt: number | undefined,
  now: number,
) {
  if (rule.favoritesOnly && !track.isFavorite) return false;
  if (rule.unheardOnly && lastPlayedAt !== undefined) return false;
  if (
    rule.notPlayedDays &&
    lastPlayedAt !== undefined &&
    lastPlayedAt > now - rule.notPlayedDays * 86_400_000
  )
    return false;
  if (rule.addedWithinDays && track.createdAt.getTime() < now - rule.addedWithinDays * 86_400_000)
    return false;
  if (rule.genre && !genres(track).includes(normalized(rule.genre))) return false;
  if (
    rule.language &&
    (track.languageCode !== rule.language || (track.languageConfidence ?? 0) < 0.8)
  )
    return false;
  // Download availability belongs to the requesting device, never the server.
  return true;
}

export async function meaningfulLastPlays(prisma: PrismaClient, userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ trackId: string; lastPlayedAt: number | bigint | string }>
  >`
    SELECT h."trackId", MAX(h."playedAt") AS "lastPlayedAt"
    FROM "MusicHistory" h JOIN "MusicTrack" t ON t."id" = h."trackId"
    WHERE h."userId" = ${userId} AND h."listenedSeconds" >=
      CASE WHEN t."duration" > 0 THEN MIN(30, t."duration" * 0.45) ELSE 15 END
    GROUP BY h."trackId"`;
  return new Map(
    rows.map((row) => [
      row.trackId,
      typeof row.lastPlayedAt === 'string'
        ? Date.parse(row.lastPlayedAt)
        : Number(row.lastPlayedAt),
    ]),
  );
}

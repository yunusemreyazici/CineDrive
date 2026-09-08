import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import {
  findMusicTracksByIdsWithRelations,
  formatMusicTrack,
  parseGenres,
} from '../utils/music-format.js';

export type ReplayPeriod = 'day' | 'week' | 'month' | 'year';

const MINUTE_MS = 60_000;
const REPLAY_METADATA_BATCH_SIZE = 400;

const replayTrackMetadataSelect = {
  id: true,
  genres: true,
  album: {
    select: { id: true, title: true, artwork: { select: { id: true } } },
  },
  primaryArtist: {
    select: { id: true, name: true, artwork: { select: { id: true } } },
  },
} satisfies Prisma.MusicTrackSelect;

type ReplayTrackMetadata = Prisma.MusicTrackGetPayload<{
  select: typeof replayTrackMetadataSelect;
}>;

const shiftedToLocal = (date: Date, timezoneOffsetMinutes: number) =>
  new Date(date.getTime() + timezoneOffsetMinutes * MINUTE_MS);

const localMidnightAsUtc = (
  year: number,
  month: number,
  day: number,
  timezoneOffsetMinutes: number,
) => new Date(Date.UTC(year, month, day) - timezoneOffsetMinutes * MINUTE_MS);

export const replayLocalClock = (date: Date, timezoneOffsetMinutes: number) => {
  const local = shiftedToLocal(date, timezoneOffsetMinutes);
  return { hour: local.getUTCHours(), weekday: local.getUTCDay() };
};

export const replayPeriodRange = (
  period: ReplayPeriod,
  year: number | undefined,
  timezoneOffsetMinutes: number,
  now = new Date(),
) => {
  const localNow = shiftedToLocal(now, timezoneOffsetMinutes);
  if (period === 'year') {
    const selectedYear = year || localNow.getUTCFullYear();
    return {
      start: localMidnightAsUtc(selectedYear, 0, 1, timezoneOffsetMinutes),
      end: localMidnightAsUtc(selectedYear + 1, 0, 1, timezoneOffsetMinutes),
      year: selectedYear,
    };
  }
  if (period === 'day') {
    return {
      start: localMidnightAsUtc(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate(),
        timezoneOffsetMinutes,
      ),
      end: now,
      year: null,
    };
  }
  return {
    start: new Date(now.getTime() - (period === 'week' ? 7 : 30) * 24 * 60 * MINUTE_MS),
    end: now,
    year: null,
  };
};

const increment = <T>(map: Map<string, T>, key: string, create: () => T) => {
  const current = map.get(key);
  if (current) return current;
  const value = create();
  map.set(key, value);
  return value;
};

export class MusicReplayService {
  constructor(private readonly prisma: PrismaClient) {}

  public async get(userId: string, period: ReplayPeriod, year?: number, timezoneOffsetMinutes = 0) {
    const {
      start,
      end,
      year: selectedYear,
    } = replayPeriodRange(period, year, timezoneOffsetMinutes);
    const entries = await this.prisma.musicHistory.findMany({
      where: { userId, playedAt: { gte: start, lt: end } },
      select: {
        trackId: true,
        listenedSeconds: true,
        playedAt: true,
      },
      orderBy: { playedAt: 'asc' },
    });
    const trackIds = [...new Set(entries.map((entry) => entry.trackId))];
    const trackMetadataById = new Map<string, ReplayTrackMetadata>();
    for (let offset = 0; offset < trackIds.length; offset += REPLAY_METADATA_BATCH_SIZE) {
      const metadata = await this.prisma.musicTrack.findMany({
        where: { id: { in: trackIds.slice(offset, offset + REPLAY_METADATA_BATCH_SIZE) } },
        select: replayTrackMetadataSelect,
      });
      metadata.forEach((track) => trackMetadataById.set(track.id, track));
    }
    const trackStats = new Map<string, { id: string; seconds: number; plays: number }>();
    const albumStats = new Map<
      string,
      { id: string; title: string; artworkUrl: string | null; seconds: number; plays: number }
    >();
    const artistStats = new Map<
      string,
      { id: string; name: string; artworkUrl: string | null; seconds: number; plays: number }
    >();
    const genres = new Map<string, number>();
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0, plays: 0 }));
    const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, seconds: 0, plays: 0 }));
    let totalSeconds = 0;
    for (const entry of entries) {
      const metadata = trackMetadataById.get(entry.trackId);
      const seconds = Math.max(0, entry.listenedSeconds);
      totalSeconds += seconds;
      const track = increment(trackStats, entry.trackId, () => ({
        id: entry.trackId,
        seconds: 0,
        plays: 0,
      }));
      track.seconds += seconds;
      track.plays += 1;
      if (metadata?.album) {
        const album = increment(albumStats, metadata.album.id, () => ({
          id: metadata.album!.id,
          title: metadata.album!.title,
          artworkUrl: metadata.album!.artwork
            ? `/api/music/artwork/${metadata.album!.artwork!.id}`
            : null,
          seconds: 0,
          plays: 0,
        }));
        album.seconds += seconds;
        album.plays += 1;
      }
      if (metadata?.primaryArtist) {
        const artist = increment(artistStats, metadata.primaryArtist.id, () => ({
          id: metadata.primaryArtist!.id,
          name: metadata.primaryArtist!.name,
          artworkUrl: metadata.primaryArtist!.artwork
            ? `/api/music/artwork/${metadata.primaryArtist!.artwork.id}`
            : null,
          seconds: 0,
          plays: 0,
        }));
        artist.seconds += seconds;
        artist.plays += 1;
      }
      for (const genre of parseGenres(metadata?.genres))
        genres.set(genre, (genres.get(genre) || 0) + seconds);
      const { hour, weekday: day } = replayLocalClock(entry.playedAt, timezoneOffsetMinutes);
      hours[hour]!.seconds += seconds;
      hours[hour]!.plays += 1;
      weekdays[day]!.seconds += seconds;
      weekdays[day]!.plays += 1;
    }
    const bySeconds = <T extends { seconds: number }>(values: Iterable<T>) =>
      [...values].sort((a, b) => b.seconds - a.seconds);
    const rankedTracks = bySeconds(trackStats.values()).slice(0, 10);
    const hydratedTracks = await findMusicTracksByIdsWithRelations(
      this.prisma,
      userId,
      rankedTracks.map((item) => item.id),
      {
        library: { OR: [{ userId }, { memberships: { some: { userId } } }] },
      },
    );
    const tracksById = new Map(
      hydratedTracks.map(formatMusicTrack).map((track) => [track.id, track]),
    );
    return {
      period,
      year: selectedYear,
      range: { start: start.toISOString(), end: end.toISOString() },
      totalSeconds,
      totalPlays: entries.length,
      uniqueTracks: trackStats.size,
      topTracks: rankedTracks.flatMap((item) => {
        const track = tracksById.get(item.id);
        return track ? [{ track, seconds: item.seconds, plays: item.plays }] : [];
      }),
      topAlbums: bySeconds(albumStats.values()).slice(0, 10),
      topArtists: bySeconds(artistStats.values()).slice(0, 10),
      hours,
      weekdays,
      genres: [...genres.entries()]
        .map(([name, seconds]) => ({ name, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 12),
    };
  }
}

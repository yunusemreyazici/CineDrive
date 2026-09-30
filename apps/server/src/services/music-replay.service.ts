import type { Prisma, PrismaClient } from '@cinedrive/prisma';
import {
  findMusicTracksByIdsWithRelations,
  formatMusicTrack,
  parseGenres,
} from '../utils/music-format.js';

export type ReplayPeriod = 'day' | 'week' | 'month' | 'year';

const MINUTE_MS = 60_000;
const REPLAY_METADATA_BATCH_SIZE = 400;
const REPLAY_HISTORY_BATCH_SIZE = 2_000;
const WEEKDAYS = new Map([
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
]);

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

const replayFormatter = (timeZone?: string) =>
  timeZone
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
    : undefined;

const zonedParts = (date: Date, formatter: Intl.DateTimeFormat) => {
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    second: Number(value('second')),
    weekday: WEEKDAYS.get(value('weekday') || '') ?? 0,
  };
};

const zoneOffsetMinutes = (date: Date, formatter: Intl.DateTimeFormat) => {
  const parts = zonedParts(date, formatter);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((representedAsUtc - date.getTime()) / MINUTE_MS);
};

const localMidnightAsUtc = (
  year: number,
  month: number,
  day: number,
  timezoneOffsetMinutes: number,
  formatter?: Intl.DateTimeFormat,
) => {
  const localTimestamp = Date.UTC(year, month, day);
  if (!formatter) return new Date(localTimestamp - timezoneOffsetMinutes * MINUTE_MS);
  let result = new Date(localTimestamp);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = new Date(localTimestamp - zoneOffsetMinutes(result, formatter) * MINUTE_MS);
    if (next.getTime() === result.getTime()) break;
    result = next;
  }
  return result;
};

export const replayLocalClock = (date: Date, timezoneOffsetMinutes: number, timeZone?: string) =>
  localClock(date, timezoneOffsetMinutes, replayFormatter(timeZone));

const localClock = (date: Date, timezoneOffsetMinutes: number, formatter?: Intl.DateTimeFormat) => {
  if (formatter) {
    const parts = zonedParts(date, formatter);
    return { hour: parts.hour, weekday: parts.weekday };
  }
  const local = shiftedToLocal(date, timezoneOffsetMinutes);
  return { hour: local.getUTCHours(), weekday: local.getUTCDay() };
};

export const replayPeriodRange = (
  period: ReplayPeriod,
  year: number | undefined,
  timezoneOffsetMinutes: number,
  now = new Date(),
  timeZone?: string,
) => periodRange(period, year, timezoneOffsetMinutes, now, replayFormatter(timeZone));

const periodRange = (
  period: ReplayPeriod,
  year: number | undefined,
  timezoneOffsetMinutes: number,
  now: Date,
  formatter?: Intl.DateTimeFormat,
) => {
  const localNow = formatter ? zonedParts(now, formatter) : null;
  const currentYear = localNow?.year ?? shiftedToLocal(now, timezoneOffsetMinutes).getUTCFullYear();
  if (period === 'year') {
    const selectedYear = year || currentYear;
    return {
      start: localMidnightAsUtc(selectedYear, 0, 1, timezoneOffsetMinutes, formatter),
      end: localMidnightAsUtc(selectedYear + 1, 0, 1, timezoneOffsetMinutes, formatter),
      year: selectedYear,
    };
  }
  if (period === 'day') {
    const fallbackLocalNow = shiftedToLocal(now, timezoneOffsetMinutes);
    return {
      start: localMidnightAsUtc(
        localNow?.year ?? fallbackLocalNow.getUTCFullYear(),
        (localNow?.month ?? fallbackLocalNow.getUTCMonth() + 1) - 1,
        localNow?.day ?? fallbackLocalNow.getUTCDate(),
        timezoneOffsetMinutes,
        formatter,
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

  public async get(
    userId: string,
    period: ReplayPeriod,
    year?: number,
    timezoneOffsetMinutes = 0,
    timeZone?: string,
  ) {
    // Request-scoped: no formatter per history row and no unbounded global cache.
    const formatter = replayFormatter(timeZone);
    const {
      start,
      end,
      year: selectedYear,
    } = periodRange(period, year, timezoneOffsetMinutes, new Date(), formatter);
    const trackStats = new Map<string, { id: string; seconds: number; plays: number }>();
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0, plays: 0 }));
    const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, seconds: 0, plays: 0 }));
    let totalSeconds = 0;
    let totalPlays = 0;
    let cursor: string | undefined;
    while (true) {
      const entries = await this.prisma.musicHistory.findMany({
        where: { userId, playedAt: { gte: start, lt: end } },
        select: { id: true, trackId: true, listenedSeconds: true, playedAt: true },
        orderBy: [{ playedAt: 'asc' }, { id: 'asc' }],
        take: REPLAY_HISTORY_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const entry of entries) {
        const seconds = Math.max(0, entry.listenedSeconds);
        totalSeconds += seconds;
        totalPlays += 1;
        const track = increment(trackStats, entry.trackId, () => ({
          id: entry.trackId,
          seconds: 0,
          plays: 0,
        }));
        track.seconds += seconds;
        track.plays += 1;
        const { hour, weekday: day } = localClock(entry.playedAt, timezoneOffsetMinutes, formatter);
        hours[hour]!.seconds += seconds;
        hours[hour]!.plays += 1;
        weekdays[day]!.seconds += seconds;
        weekdays[day]!.plays += 1;
      }
      if (entries.length < REPLAY_HISTORY_BATCH_SIZE) break;
      cursor = entries.at(-1)!.id;
    }
    const trackIds = [...trackStats.keys()];
    const trackMetadataById = new Map<string, ReplayTrackMetadata>();
    for (let offset = 0; offset < trackIds.length; offset += REPLAY_METADATA_BATCH_SIZE) {
      const metadata = await this.prisma.musicTrack.findMany({
        where: { id: { in: trackIds.slice(offset, offset + REPLAY_METADATA_BATCH_SIZE) } },
        select: replayTrackMetadataSelect,
      });
      metadata.forEach((track) => trackMetadataById.set(track.id, track));
    }
    const albumStats = new Map<
      string,
      { id: string; title: string; artworkUrl: string | null; seconds: number; plays: number }
    >();
    const artistStats = new Map<
      string,
      { id: string; name: string; artworkUrl: string | null; seconds: number; plays: number }
    >();
    const genres = new Map<string, number>();
    for (const track of trackStats.values()) {
      const metadata = trackMetadataById.get(track.id);
      const { seconds, plays } = track;
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
        album.plays += plays;
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
        artist.plays += plays;
      }
      for (const genre of parseGenres(metadata?.genres))
        genres.set(genre, (genres.get(genre) || 0) + seconds);
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
      totalPlays,
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

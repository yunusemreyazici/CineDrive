import type { PrismaClient } from '@prisma/client';
import { formatMusicTrack, musicTrackInclude, parseGenres } from '../utils/music-format.js';

export type ReplayPeriod = 'day' | 'week' | 'month' | 'year';

const periodStart = (period: ReplayPeriod, year?: number) => {
  const now = new Date();
  if (period === 'year') return new Date(Date.UTC(year || now.getUTCFullYear(), 0, 1));
  if (period === 'day') {
    const result = new Date(now);
    result.setHours(0, 0, 0, 0);
    return result;
  }
  const result = new Date(now);
  result.setUTCDate(result.getUTCDate() - (period === 'week' ? 7 : 30));
  return result;
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

  public async get(userId: string, period: ReplayPeriod, year?: number) {
    const start = periodStart(period, year);
    const end =
      period === 'year'
        ? new Date(Date.UTC((year || new Date().getUTCFullYear()) + 1, 0, 1))
        : new Date();
    const entries = await this.prisma.musicHistory.findMany({
      where: { userId, playedAt: { gte: start, lt: end } },
      include: { track: { include: musicTrackInclude(userId) } },
      orderBy: { playedAt: 'asc' },
    });
    const trackStats = new Map<
      string,
      { track: (typeof entries)[number]['track']; seconds: number; plays: number }
    >();
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
      const seconds = Math.max(0, entry.listenedSeconds);
      totalSeconds += seconds;
      const track = increment(trackStats, entry.trackId, () => ({
        track: entry.track,
        seconds: 0,
        plays: 0,
      }));
      track.seconds += seconds;
      track.plays += 1;
      if (entry.track.album) {
        const album = increment(albumStats, entry.track.album.id, () => ({
          id: entry.track.album!.id,
          title: entry.track.album!.title,
          artworkUrl: entry.track.album!.artwork
            ? `/api/music/artwork/${entry.track.album!.artwork!.id}`
            : null,
          seconds: 0,
          plays: 0,
        }));
        album.seconds += seconds;
        album.plays += 1;
      }
      if (entry.track.primaryArtist) {
        const artist = increment(artistStats, entry.track.primaryArtist.id, () => ({
          id: entry.track.primaryArtist!.id,
          name: entry.track.primaryArtist!.name,
          artworkUrl: entry.track.primaryArtist!.artwork
            ? `/api/music/artwork/${entry.track.primaryArtist!.artwork.id}`
            : null,
          seconds: 0,
          plays: 0,
        }));
        artist.seconds += seconds;
        artist.plays += 1;
      }
      for (const genre of parseGenres(entry.track.genres))
        genres.set(genre, (genres.get(genre) || 0) + seconds);
      const hour = entry.playedAt.getHours();
      const day = entry.playedAt.getDay();
      hours[hour]!.seconds += seconds;
      hours[hour]!.plays += 1;
      weekdays[day]!.seconds += seconds;
      weekdays[day]!.plays += 1;
    }
    const bySeconds = <T extends { seconds: number }>(values: Iterable<T>) =>
      [...values].sort((a, b) => b.seconds - a.seconds);
    return {
      period,
      year: period === 'year' ? year || new Date().getUTCFullYear() : null,
      range: { start: start.toISOString(), end: end.toISOString() },
      totalSeconds,
      totalPlays: entries.length,
      uniqueTracks: trackStats.size,
      topTracks: bySeconds(trackStats.values())
        .slice(0, 10)
        .map((item) => ({
          track: formatMusicTrack(item.track),
          seconds: item.seconds,
          plays: item.plays,
        })),
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

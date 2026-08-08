import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { MusicLyricsLineDto } from '@cinedrive/shared';
import { env } from '../config/env.js';

const MAX_LYRICS_BYTES = 1024 * 1024;
const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_PATTERN = /^\[(ar|ti|al|by|length|re|ve|la):([^\]]*)\]$/i;
const LRCLIB_API_BASE_URL = 'https://lrclib.net/api';
const LRCLIB_USER_AGENT = `CineDrive/1.0.0 (${env.PUBLIC_URL})`;
const LOOKUP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 300;

interface LrclibLyrics {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface OnlineLyricsLookupInput {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export type OnlineLyricsLookupResult =
  | { status: 'found'; lyrics: Awaited<ReturnType<MusicLyricsService['syncTrackLyrics']>> }
  | { status: 'not_found' };

const onlineLookupCache = new Map<string, { expiresAt: number; result: LrclibLyrics | null }>();
let providerQueue: Promise<void> = Promise.resolve();
let nextProviderRequestAt = 0;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const scheduleProviderRequest = <T>(request: () => Promise<T>) => {
  const run = async () => {
    const delay = Math.max(0, nextProviderRequestAt - Date.now());
    if (delay) await wait(delay);
    nextProviderRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    return request();
  };
  const scheduled = providerQueue.then(run, run);
  providerQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
};

const normalizeSignaturePart = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const isLrclibLyrics = (value: unknown): value is LrclibLyrics => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LrclibLyrics>;
  return (
    typeof item.id === 'number' &&
    typeof item.trackName === 'string' &&
    typeof item.artistName === 'string' &&
    typeof item.albumName === 'string' &&
    typeof item.duration === 'number' &&
    typeof item.instrumental === 'boolean' &&
    (typeof item.plainLyrics === 'string' || item.plainLyrics === null) &&
    (typeof item.syncedLyrics === 'string' || item.syncedLyrics === null)
  );
};

const matchesSignature = (lyrics: LrclibLyrics, input: OnlineLyricsLookupInput) =>
  normalizeSignaturePart(lyrics.trackName) === normalizeSignaturePart(input.title) &&
  normalizeSignaturePart(lyrics.artistName) === normalizeSignaturePart(input.artist) &&
  normalizeSignaturePart(lyrics.albumName) === normalizeSignaturePart(input.album) &&
  Math.abs(lyrics.duration - input.duration) <= 2;

const parseRetryAfter = (value: string | null) => {
  if (!value) return 1000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 15_000));
  const date = Date.parse(value);
  return Number.isNaN(date) ? 1000 : Math.max(0, Math.min(date - Date.now(), 15_000));
};

const fetchLrclib = async (url: string, attempt = 0): Promise<Response> => {
  const response = await fetch(url, {
    headers: { 'User-Agent': LRCLIB_USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  if ((response.status === 429 || response.status === 503) && attempt === 0) {
    await wait(
      response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : 1000,
    );
    return fetchLrclib(url, attempt + 1);
  }
  return response;
};

const searchLrclib = async (input: OnlineLyricsLookupInput) => {
  await wait(MIN_REQUEST_INTERVAL_MS);
  const query = new URLSearchParams({ track_name: input.title, artist_name: input.artist });
  const response = await fetchLrclib(`${LRCLIB_API_BASE_URL}/search?${query}`);
  if (!response.ok) throw new Error(`LRCLIB_SEARCH_HTTP_${response.status}`);
  const result: unknown = await response.json();
  if (!Array.isArray(result)) return null;
  const candidates = result.filter(
    (item): item is LrclibLyrics =>
      isLrclibLyrics(item) &&
      normalizeSignaturePart(item.trackName) === normalizeSignaturePart(input.title) &&
      normalizeSignaturePart(item.artistName) === normalizeSignaturePart(input.artist) &&
      Math.abs(item.duration - input.duration) <= 2,
  );
  const exactAlbum = candidates.find(
    (item) => normalizeSignaturePart(item.albumName) === normalizeSignaturePart(input.album),
  );
  return exactAlbum || (candidates.length === 1 ? candidates[0]! : null);
};

const requestLrclib = async (input: OnlineLyricsLookupInput) => {
  const query = new URLSearchParams({
    track_name: input.title,
    artist_name: input.artist,
    album_name: input.album,
    duration: String(Math.round(input.duration)),
  });
  const response = await fetchLrclib(`${LRCLIB_API_BASE_URL}/get?${query}`);
  if (response.status === 404) return searchLrclib(input);
  if (!response.ok) throw new Error(`LRCLIB_HTTP_${response.status}`);
  const result: unknown = await response.json();
  return isLrclibLyrics(result) && matchesSignature(result, input) ? result : null;
};

export const findOnlineLyrics = async (input: OnlineLyricsLookupInput) => {
  const cacheKey = [input.title, input.artist, input.album, String(Math.round(input.duration))]
    .map(normalizeSignaturePart)
    .join('|');
  const cached = onlineLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const result = await scheduleProviderRequest(() => requestLrclib(input));
  onlineLookupCache.set(cacheKey, { expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS, result });
  return result;
};

export interface ParsedLrc {
  lines: MusicLyricsLineDto[];
  isSynced: boolean;
  offsetMs: number;
  metadata: Record<string, string>;
}

const fractionToMilliseconds = (fraction?: string) =>
  fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;

export const parseLrc = (input: string): ParsedLrc => {
  const content = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const metadata: Record<string, string> = {};
  let offsetMs = 0;
  const timedLines: Array<MusicLyricsLineDto & { order: number }> = [];
  const plainLines: MusicLyricsLineDto[] = [];

  content.split('\n').forEach((rawLine, order) => {
    const line = rawLine.trim();
    if (!line) return;
    const offsetMatch = line.match(/^\[offset:([+-]?\d+)\]$/i);
    if (offsetMatch) {
      offsetMs = Number(offsetMatch[1]) || 0;
      return;
    }
    const metadataMatch = line.match(METADATA_PATTERN);
    if (metadataMatch) {
      metadata[metadataMatch[1]!.toLowerCase()] = metadataMatch[2]!.trim();
      return;
    }

    const timestamps = [...line.matchAll(TIMESTAMP_PATTERN)];
    const text = line.replace(TIMESTAMP_PATTERN, '').trim();
    if (!timestamps.length) {
      plainLines.push({ timeMs: null, text });
      return;
    }
    for (const match of timestamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds > 59) continue;
      timedLines.push({
        timeMs: minutes * 60_000 + seconds * 1000 + fractionToMilliseconds(match[3]),
        text,
        order,
      });
    }
  });

  if (!timedLines.length) return { lines: plainLines, isSynced: false, offsetMs, metadata };
  const lines = timedLines
    .map((line) => ({ ...line, timeMs: Math.max(0, (line.timeMs || 0) + offsetMs) }))
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0) || a.order - b.order)
    .map(({ timeMs, text }) => ({ timeMs, text }));
  return { lines, isSynced: true, offsetMs, metadata };
};

export const inferLyricsLanguage = (sourceName: string, metadataLanguage?: string) => {
  if (metadataLanguage?.trim()) return metadataLanguage.trim().toLowerCase();
  const match = path.basename(sourceName).match(/\.([a-z]{2,3}(?:-[a-z]{2})?)\.lrc$/i);
  return match?.[1]?.toLowerCase();
};

export class MusicLyricsService {
  constructor(private readonly prisma: PrismaClient) {}

  public async syncTrackLyrics(options: {
    trackId: string;
    sourceName: string;
    content: string;
    language?: string | null;
    sourceType?: 'sidecar' | 'manual' | 'lrclib';
  }) {
    if (Buffer.byteLength(options.content, 'utf8') > MAX_LYRICS_BYTES) {
      throw new Error('LYRICS_FILE_TOO_LARGE');
    }
    const normalizedContent = options.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const parsed = parseLrc(normalizedContent);
    const language =
      options.language || inferLyricsLanguage(options.sourceName, parsed.metadata.la);
    return this.prisma.musicLyrics.upsert({
      where: { trackId: options.trackId },
      create: {
        trackId: options.trackId,
        content: normalizedContent,
        sourceName: options.sourceName,
        sourceType: options.sourceType || 'sidecar',
        language,
        isSynced: parsed.isSynced,
        offsetMs: parsed.offsetMs,
      },
      update: {
        content: normalizedContent,
        sourceName: options.sourceName,
        sourceType: options.sourceType || 'sidecar',
        language,
        isSynced: parsed.isSynced,
        offsetMs: parsed.offsetMs,
      },
    });
  }

  public removeSidecarLyrics(trackId: string) {
    return this.prisma.musicLyrics.deleteMany({ where: { trackId, sourceType: 'sidecar' } });
  }

  public async lookupOnlineLyrics(
    input: OnlineLyricsLookupInput,
  ): Promise<OnlineLyricsLookupResult> {
    const existing = await this.prisma.musicLyrics.findUnique({
      where: { trackId: input.trackId },
    });
    if (existing) return { status: 'found', lyrics: existing };
    const match = await findOnlineLyrics(input);
    const content = match?.syncedLyrics?.trim() || match?.plainLyrics?.trim();
    if (!match || match.instrumental || !content) return { status: 'not_found' };
    const lyrics = await this.syncTrackLyrics({
      trackId: input.trackId,
      content,
      sourceName: `LRCLIB #${match.id}`,
      sourceType: 'lrclib',
    });
    return { status: 'found', lyrics };
  }
}

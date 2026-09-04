import path from 'node:path';
import type { PrismaClient } from '@cinedrive/prisma';
import type { MusicLyricsLineDto } from '@cinedrive/shared';
import { env } from '../config/env.js';

const MAX_LYRICS_BYTES = 1024 * 1024;
const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIMESTAMP_PATTERN = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const METADATA_PATTERN = /^\[(ar|ti|al|by|length|re|ve|la):([^\]]*)\]$/i;
const LRCLIB_API_BASE_URL = 'https://lrclib.net/api';
const LRCLIB_USER_AGENT = `CineDrive/1.1.0 (${env.PUBLIC_URL})`;
const LOOKUP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const NOT_FOUND_LOOKUP_CACHE_TTL_MS = 15 * 60 * 1000;
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
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/\p{M}+/gu, '')
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
  onlineLookupCache.set(cacheKey, {
    expiresAt:
      Date.now() + (result === null ? NOT_FOUND_LOOKUP_CACHE_TTL_MS : LOOKUP_CACHE_TTL_MS),
    result,
  });
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
    const rawText = line.replace(TIMESTAMP_PATTERN, '').trim();
    const wordMatches = [...rawText.matchAll(WORD_TIMESTAMP_PATTERN)];
    const text = rawText.replace(WORD_TIMESTAMP_PATTERN, '').trim();
    const words = wordMatches.map((match, index) => ({
      timeMs:
        Number(match[1]) * 60_000 +
        Number(match[2]) * 1000 +
        fractionToMilliseconds(match[3]) +
        offsetMs,
      text: rawText.slice((match.index || 0) + match[0].length, wordMatches[index + 1]?.index).trim(),
    })).filter((word) => word.text);
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
        ...(words.length ? { words } : {}),
        order,
      });
    }
  });

  if (!timedLines.length) return { lines: plainLines, isSynced: false, offsetMs, metadata };
  const lines = timedLines
    .map((line) => ({ ...line, timeMs: Math.max(0, (line.timeMs || 0) + offsetMs) }))
    .sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0) || a.order - b.order)
    .map(({ timeMs, text, words }) => ({ timeMs, text, ...(words?.length ? { words } : {}) }));
  return { lines, isSynced: true, offsetMs, metadata };
};

const formatTimestamp = (milliseconds: number) => {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const centiseconds = Math.floor((safe % 1000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

export const alignPlainLyrics = (
  input: string,
  durationSeconds: number,
  leadInMs = 1000,
  endPaddingMs = 5000,
) => {
  const lines = parseLrc(input).lines.map((line) => line.text.trim()).filter(Boolean);
  if (!lines.length) return '';
  const available = Math.max(1000, durationSeconds * 1000 - leadInMs - endPaddingMs);
  const step = lines.length === 1 ? 0 : available / (lines.length - 1);
  return lines.map((line, index) => `${formatTimestamp(leadInMs + index * step)} ${line}`).join('\n');
};

const translateLine = async (text: string, source: string, target: string) => {
  if (!env.LIBRETRANSLATE_URL) throw new Error('TRANSLATION_PROVIDER_NOT_CONFIGURED');
  const endpoint = new URL('/translate', env.LIBRETRANSLATE_URL).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: source || 'auto',
      target,
      format: 'text',
      ...(env.LIBRETRANSLATE_API_KEY ? { api_key: env.LIBRETRANSLATE_API_KEY } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`TRANSLATION_PROVIDER_HTTP_${response.status}`);
  const payload = (await response.json()) as { translatedText?: string };
  if (!payload.translatedText) throw new Error('TRANSLATION_PROVIDER_INVALID_RESPONSE');
  return payload.translatedText.trim();
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
    translatedContent?: string | null;
    romanizedContent?: string | null;
    translationLanguage?: string | null;
    sourceType?: 'sidecar' | 'manual' | 'lrclib';
  }) {
    if (Buffer.byteLength(options.content, 'utf8') > MAX_LYRICS_BYTES) {
      throw new Error('LYRICS_FILE_TOO_LARGE');
    }
    const normalizedContent = options.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const parsed = parseLrc(normalizedContent);
    const translatedContent =
      options.translatedContent?.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') || null;
    const romanizedContent =
      options.romanizedContent?.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') || null;
    if (
      (translatedContent && Buffer.byteLength(translatedContent, 'utf8') > MAX_LYRICS_BYTES) ||
      (romanizedContent && Buffer.byteLength(romanizedContent, 'utf8') > MAX_LYRICS_BYTES)
    ) {
      throw new Error('LYRICS_FILE_TOO_LARGE');
    }
    const language =
      options.language || inferLyricsLanguage(options.sourceName, parsed.metadata.la);
    return this.prisma.musicLyrics.upsert({
      where: { trackId: options.trackId },
      create: {
        trackId: options.trackId,
        content: normalizedContent,
        translatedContent,
        romanizedContent,
        sourceName: options.sourceName,
        sourceType: options.sourceType || 'sidecar',
        language,
        translationLang: options.translationLanguage,
        isSynced: parsed.isSynced,
        offsetMs: parsed.offsetMs,
      },
      update: {
        content: normalizedContent,
        translatedContent,
        romanizedContent,
        sourceName: options.sourceName,
        sourceType: options.sourceType || 'sidecar',
        language,
        translationLang: options.translationLanguage,
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

  public async translate(trackId: string, targetLanguage: string) {
    const lyrics = await this.prisma.musicLyrics.findUniqueOrThrow({ where: { trackId } });
    const parsed = parseLrc(lyrics.content);
    const translated: string[] = new Array(parsed.lines.length);
    const sourceLanguage = (lyrics.language || 'auto').split('-')[0]!;
    const normalizedTarget = targetLanguage.split('-')[0]!;
    for (let index = 0; index < parsed.lines.length; index += 4) {
      const batch = parsed.lines.slice(index, index + 4);
      const results = await Promise.all(batch.map((line) => line.text ? translateLine(line.text, sourceLanguage, normalizedTarget) : Promise.resolve('')));
      results.forEach((text, batchIndex) => {
        const line = batch[batchIndex]!;
        translated[index + batchIndex] = line.timeMs === null ? text : `${formatTimestamp(line.timeMs)} ${text}`;
      });
    }
    const content = translated.join('\n');
    return this.prisma.musicLyricsTranslation.upsert({
      where: { lyricsId_language: { lyricsId: lyrics.id, language: targetLanguage } },
      create: { lyricsId: lyrics.id, language: targetLanguage, content, provider: 'libretranslate', isMachine: true },
      update: { content, provider: 'libretranslate', isMachine: true },
    });
  }
}

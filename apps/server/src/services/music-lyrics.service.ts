import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { MusicLyricsLineDto } from '@cinedrive/shared';

const MAX_LYRICS_BYTES = 1024 * 1024;
const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const METADATA_PATTERN = /^\[(ar|ti|al|by|length|re|ve|la):([^\]]*)\]$/i;

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
    sourceType?: 'sidecar' | 'manual';
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
}

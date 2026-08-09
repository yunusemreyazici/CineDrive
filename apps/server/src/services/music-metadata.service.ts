import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseFile, selectCover, type IAudioMetadata } from 'music-metadata';

export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus',
  '.wav',
  '.wma',
] as const;
const REMOTE_HEAD_BYTES = 8 * 1024 * 1024;
const REMOTE_TAIL_BYTES = 4 * 1024 * 1024;
// Covers are normalized before persistence. This input cap blocks malformed
// tags without rejecting ordinary high-resolution embedded artwork.
const MAX_ARTWORK_INPUT_BYTES = 20 * 1024 * 1024;

export interface ParsedMusicMetadata {
  title: string;
  artists: string[];
  albumArtist: string;
  album: string;
  trackNumber: number;
  discNumber: number;
  year?: number;
  genres: string[];
  duration?: number;
  container?: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  lossless?: boolean;
  replayGainTrackDb?: number;
  replayGainTrackPeak?: number;
  replayGainAlbumDb?: number;
  replayGainAlbumPeak?: number;
  releaseType: string;
  secondaryTypes: string[];
  credits: Array<{
    name: string;
    role: string;
    instrument?: string;
    musicbrainzId?: string;
    source: 'tag';
  }>;
  musicbrainzRecordingId?: string;
  musicbrainzArtistIds: string[];
  musicbrainzAlbumArtistId?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  artwork?: { mimeType: string; data: Buffer };
}

export const isAudioFilename = (name: string) =>
  AUDIO_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

export const cleanMusicFilenameTitle = (name: string) =>
  path
    .basename(name, path.extname(name))
    .replace(/^\s*(?:cd\s*\d+[ ._-]*)?(?:\d{1,3}[ ._-]+)+/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || path.basename(name, path.extname(name));

const clean = (value?: string | null) => value?.trim() || undefined;

export class MusicMetadataService {
  public async parseLocalFile(filePath: string, libraryRoot: string): Promise<ParsedMusicMetadata> {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
    const relativeParts = path.relative(libraryRoot, filePath).split(path.sep);
    const albumFallback = relativeParts.length >= 2 ? relativeParts.at(-2) : undefined;
    const artistFallback = relativeParts.length >= 3 ? relativeParts.at(-3) : undefined;
    const sidecar = await this.readSidecarArtwork(path.dirname(filePath));
    return this.toParsed(metadata, path.basename(filePath), artistFallback, albumFallback, sidecar);
  }

  public async parseRemoteFile(options: {
    name: string;
    size: bigint;
    readRange: (start: number, end: number) => Promise<Buffer>;
  }): Promise<ParsedMusicMetadata> {
    if (options.size <= 0n || options.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('INVALID_REMOTE_AUDIO_SIZE');
    }
    const size = Number(options.size);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-music-'));
    const tempPath = path.join(tempDirectory, `track${path.extname(options.name).toLowerCase()}`);
    try {
      const file = await fs.open(tempPath, 'w');
      try {
        await file.truncate(size);
        const headEnd = Math.min(size, REMOTE_HEAD_BYTES) - 1;
        const head = await options.readRange(0, headEnd);
        await file.write(head, 0, head.length, 0);
        if (size > REMOTE_HEAD_BYTES) {
          const tailStart = Math.max(REMOTE_HEAD_BYTES, size - REMOTE_TAIL_BYTES);
          const tail = await options.readRange(tailStart, size - 1);
          await file.write(tail, 0, tail.length, tailStart);
        }
      } finally {
        await file.close();
      }
      const metadata = await parseFile(tempPath, { duration: true, skipCovers: false });
      return this.toParsed(metadata, options.name);
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private toParsed(
    metadata: IAudioMetadata,
    filename: string,
    artistFallback?: string,
    albumFallback?: string,
    sidecar?: { mimeType: string; data: Buffer },
  ): ParsedMusicMetadata {
    const common = metadata.common;
    const taggedArtists = (
      common.artists?.length ? common.artists : common.artist ? [common.artist] : []
    )
      .map((artist) => artist.trim())
      .filter(Boolean);
    const artists =
      taggedArtists.length > 0 ? taggedArtists : [clean(artistFallback) || 'Bilinmeyen Sanatçı'];
    const albumArtist = clean(common.albumartist) || artists[0]!;
    const cover = selectCover(common.picture);
    const embedded =
      cover && cover.data.byteLength <= MAX_ARTWORK_INPUT_BYTES
        ? { mimeType: cover.format || 'image/jpeg', data: Buffer.from(cover.data) }
        : undefined;
    const releaseTypes = (common.releasetype || []).map((type) => type.trim()).filter(Boolean);
    const releaseType = (
      releaseTypes[0] || (common.compilation ? 'compilation' : 'album')
    ).toLowerCase();
    const creditGroups: Array<[string, string[] | undefined]> = [
      ['composer', common.composer],
      ['lyricist', common.lyricist?.length ? common.lyricist : common.writer],
      ['producer', common.producer],
      ['conductor', common.conductor],
      ['arranger', common.arranger],
      ['remixer', common.remixer],
      ['mixer', common.mixer],
      ['engineer', common.engineer],
    ];
    const credits = [
      ...artists.map((name, position) => ({
        name,
        role: 'performer',
        musicbrainzId: common.musicbrainz_artistid?.[position],
        source: 'tag' as const,
      })),
      ...creditGroups.flatMap(([role, names]) =>
        (names || []).map((name) => ({ name: name.trim(), role, source: 'tag' as const })),
      ),
    ].filter(
      (credit, index, all) =>
        credit.name &&
        all.findIndex(
          (candidate) => candidate.role === credit.role && candidate.name === credit.name,
        ) === index,
    );

    return {
      title: clean(common.title) || cleanMusicFilenameTitle(filename),
      artists,
      albumArtist,
      album: clean(common.album) || clean(albumFallback) || 'Bilinmeyen Albüm',
      trackNumber: common.track.no || 0,
      discNumber: common.disk.no || 1,
      year: common.year || common.originalyear,
      genres: [...new Set((common.genre || []).map((genre) => genre.trim()).filter(Boolean))],
      duration: metadata.format.duration,
      container: metadata.format.container,
      codec: metadata.format.codec,
      bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate) : undefined,
      sampleRate: metadata.format.sampleRate,
      channels: metadata.format.numberOfChannels,
      bitDepth: metadata.format.bitsPerSample,
      lossless: metadata.format.lossless,
      replayGainTrackDb: common.replaygain_track_gain?.dB,
      replayGainTrackPeak: common.replaygain_track_peak?.ratio,
      replayGainAlbumDb: common.replaygain_album_gain?.dB,
      replayGainAlbumPeak: common.replaygain_album_peak?.ratio,
      releaseType,
      secondaryTypes: releaseTypes.slice(1).map((type) => type.toLowerCase()),
      credits,
      musicbrainzRecordingId: common.musicbrainz_recordingid,
      musicbrainzArtistIds: common.musicbrainz_artistid || [],
      musicbrainzAlbumArtistId: common.musicbrainz_albumartistid?.[0],
      musicbrainzReleaseId: common.musicbrainz_albumid,
      musicbrainzReleaseGroupId: common.musicbrainz_releasegroupid,
      artwork: embedded || sidecar,
    };
  }

  private async readSidecarArtwork(directory: string) {
    for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png']) {
      try {
        const filePath = path.join(directory, name);
        const stat = await fs.stat(filePath);
        if (stat.size > MAX_ARTWORK_INPUT_BYTES) continue;
        return {
          mimeType: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
          data: await fs.readFile(filePath),
        };
      } catch {
        // Try the next conventional sidecar name.
      }
    }
    return undefined;
  }
}

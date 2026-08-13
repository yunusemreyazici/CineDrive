import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import ffmpegPath from 'ffmpeg-static';
import { MusicMetadataService, type ParsedMusicMetadata } from './music-metadata.service.js';
import { MusicBrainzService } from './musicbrainz.service.js';
import { MusicLyricsService } from './music-lyrics.service.js';

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const execFileAsync = promisify(execFile);
const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;

export class MusicLibraryService {
  public readonly metadata = new MusicMetadataService();
  public readonly lyrics: MusicLyricsService;
  private readonly musicbrainz = new MusicBrainzService();
  private readonly artworkCache = new Map<string, string | undefined>();

  constructor(private readonly prisma: PrismaClient) {
    this.lyrics = new MusicLyricsService(prisma);
  }

  public saveArtwork(userId: string, artwork: { mimeType: string; data: Buffer }) {
    return this.storeArtwork(userId, artwork);
  }

  public async indexTrack(options: {
    userId: string;
    libraryId: string;
    driveFileId: string;
    metadata: ParsedMusicMetadata;
  }) {
    const { metadata } = options;
    const artists = await Promise.all(
      metadata.artists.map((name, position) =>
        this.upsertArtist(options.userId, name, metadata.musicbrainzArtistIds[position]),
      ),
    );
    const albumArtist = await this.upsertArtist(
      options.userId,
      metadata.albumArtist,
      metadata.musicbrainzAlbumArtistId,
    );
    const artworkId = metadata.artwork
      ? await this.storeArtwork(options.userId, metadata.artwork)
      : undefined;
    const album = await this.prisma.musicAlbum.upsert({
      where: {
        userId_artistId_normalizedTitle: {
          userId: options.userId,
          artistId: albumArtist.id,
          normalizedTitle: normalize(metadata.album),
        },
      },
      create: {
        userId: options.userId,
        artistId: albumArtist.id,
        title: metadata.album,
        normalizedTitle: normalize(metadata.album),
        year: metadata.year,
        genres: JSON.stringify(metadata.genres),
        artworkId,
        musicbrainzReleaseId: metadata.musicbrainzReleaseId,
        musicbrainzReleaseGroupId: metadata.musicbrainzReleaseGroupId,
        releaseType: metadata.releaseType,
        secondaryTypes: JSON.stringify(metadata.secondaryTypes),
      },
      update: {
        title: metadata.album,
        year: metadata.year ?? undefined,
        genres: metadata.genres.length ? JSON.stringify(metadata.genres) : undefined,
        artworkId: artworkId || undefined,
        musicbrainzReleaseId: metadata.musicbrainzReleaseId || undefined,
        musicbrainzReleaseGroupId: metadata.musicbrainzReleaseGroupId || undefined,
        releaseType: metadata.releaseType || undefined,
        secondaryTypes: metadata.secondaryTypes.length
          ? JSON.stringify(metadata.secondaryTypes)
          : undefined,
      },
    });
    const existingTrack = await this.prisma.musicTrack.findUnique({
      where: { driveFileId: options.driveFileId },
      select: { metadataLocked: true },
    });
    const track = await this.prisma.musicTrack.upsert({
      where: { driveFileId: options.driveFileId },
      create: {
        libraryId: options.libraryId,
        driveFileId: options.driveFileId,
        albumId: album.id,
        primaryArtistId: artists[0]?.id || albumArtist.id,
        artworkId,
        title: metadata.title,
        normalizedTitle: normalize(metadata.title),
        discNumber: metadata.discNumber,
        trackNumber: metadata.trackNumber,
        year: metadata.year,
        genres: JSON.stringify(metadata.genres),
        duration: metadata.duration,
        musicbrainzRecordingId: metadata.musicbrainzRecordingId,
        replayGainTrackDb: metadata.replayGainTrackDb,
        replayGainTrackPeak: metadata.replayGainTrackPeak,
        replayGainAlbumDb: metadata.replayGainAlbumDb,
        replayGainAlbumPeak: metadata.replayGainAlbumPeak,
      },
      update: {
        libraryId: options.libraryId,
        ...(!existingTrack?.metadataLocked
          ? {
              albumId: album.id,
              primaryArtistId: artists[0]?.id || albumArtist.id,
              artworkId: artworkId || undefined,
              title: metadata.title,
              normalizedTitle: normalize(metadata.title),
              discNumber: metadata.discNumber,
              trackNumber: metadata.trackNumber,
              year: metadata.year ?? undefined,
              genres: JSON.stringify(metadata.genres),
            }
          : {}),
        duration: metadata.duration,
        musicbrainzRecordingId: metadata.musicbrainzRecordingId || undefined,
        replayGainTrackDb: metadata.replayGainTrackDb,
        replayGainTrackPeak: metadata.replayGainTrackPeak,
        replayGainAlbumDb: metadata.replayGainAlbumDb,
        replayGainAlbumPeak: metadata.replayGainAlbumPeak,
      },
    });
    if (!existingTrack?.metadataLocked) {
      await this.prisma.musicTrackArtist.deleteMany({ where: { trackId: track.id } });
      await this.prisma.musicTrackArtist.createMany({
        data: (artists.length ? artists : [albumArtist]).map((artist, position) => ({
          trackId: track.id,
          artistId: artist.id,
          position,
        })),
      });
    }
    await this.prisma.musicTrackCredit.deleteMany({
      where: { trackId: track.id, source: { not: 'manual' } },
    });
    const manualCredits = await this.prisma.musicTrackCredit.findMany({
      where: { trackId: track.id, source: 'manual' },
      select: { role: true, name: true, instrument: true },
    });
    const localCredits = metadata.credits.filter(
      (credit) =>
        !manualCredits.some(
          (manual) =>
            manual.role === credit.role &&
            manual.name === credit.name &&
            (manual.instrument || '') === (credit.instrument || ''),
        ),
    );
    if (localCredits.length) {
      await this.prisma.musicTrackCredit.createMany({
        data: localCredits.map((credit, position) => ({
          trackId: track.id,
          name: credit.name,
          role: credit.role,
          instrument: credit.instrument || '',
          musicbrainzId: credit.musicbrainzId,
          source: credit.source,
          position,
        })),
      });
    }

    if (!album.musicbrainzReleaseGroupId || !album.artworkId) {
      const online = await this.musicbrainz.enrichAlbum(albumArtist.name, album.title);
      if (online) {
        const onlineArtworkId =
          !album.artworkId && online.artwork
            ? await this.storeArtwork(options.userId, online.artwork)
            : undefined;
        await this.prisma.musicAlbum.update({
          where: { id: album.id },
          data: {
            musicbrainzReleaseId: album.musicbrainzReleaseId || online.releaseId,
            musicbrainzReleaseGroupId: online.releaseGroupId,
            releaseType: online.releaseType || album.releaseType,
            secondaryTypes: online.secondaryTypes.length
              ? JSON.stringify(online.secondaryTypes)
              : album.secondaryTypes,
            year: album.year || online.year,
            genres:
              album.genres && album.genres !== '[]' ? album.genres : JSON.stringify(online.genres),
            artworkId: album.artworkId || onlineArtworkId,
            metadataStatus: 'enriched',
          },
        });
        if (online.artistId && !albumArtist.musicbrainzId) {
          await this.prisma.musicArtist.update({
            where: { id: albumArtist.id },
            data: { musicbrainzId: online.artistId },
          });
        }
      }
    }

    const artistCandidates = await this.prisma.musicArtist.findMany({
      where: {
        id: { in: [...new Set([...artists.map((artist) => artist.id), albumArtist.id])] },
        userId: options.userId,
        musicbrainzId: { not: null },
        artworkId: null,
        artworkLocked: false,
      },
    });
    for (const artist of artistCandidates) {
      if (!artist.musicbrainzId) continue;
      const artistArtwork = await this.musicbrainz.findArtistArtwork({
        musicbrainzId: artist.musicbrainzId,
        artistName: artist.name,
      });
      if (!artistArtwork) continue;
      const artistArtworkId = await this.storeArtwork(options.userId, artistArtwork.artwork);
      if (!artistArtworkId) continue;
      await this.prisma.musicArtist.updateMany({
        where: { id: artist.id, userId: options.userId, artworkId: null, artworkLocked: false },
        data: {
          artworkId: artistArtworkId,
          artworkSource: artistArtwork.source || 'wikimedia-commons',
          artworkSourceUrl: artistArtwork.sourceUrl,
          artworkAttribution: artistArtwork.attribution,
          artworkLicense: artistArtwork.license,
        },
      });
    }

    return track;
  }

  private async upsertArtist(userId: string, name: string, musicbrainzId?: string) {
    const artist = await this.prisma.musicArtist.upsert({
      where: { userId_normalizedName: { userId, normalizedName: normalize(name) } },
      create: { userId, name, normalizedName: normalize(name), musicbrainzId },
      update: { name, musicbrainzId: musicbrainzId || undefined },
    });
    if (artist.musicbrainzId || musicbrainzId) return artist;
    const identity = await this.musicbrainz.matchArtistIdentity(name);
    if (!identity) return artist;
    return this.prisma.musicArtist.update({
      where: { id: artist.id },
      data: {
        musicbrainzId: identity.musicbrainzId,
        sortName: artist.sortName || identity.sortName,
      },
    });
  }

  private async storeArtwork(userId: string, artwork: { mimeType: string; data: Buffer }) {
    const sourceChecksum = createHash('sha256').update(artwork.data).digest('hex');
    const cacheKey = `${userId}:${sourceChecksum}`;
    if (this.artworkCache.has(cacheKey)) return this.artworkCache.get(cacheKey);
    const normalized = await this.normalizeArtwork(artwork);
    if (!normalized) {
      this.artworkCache.set(cacheKey, undefined);
      return undefined;
    }
    const checksum = createHash('sha256').update(normalized.data).digest('hex');
    const record = await this.prisma.musicArtwork.upsert({
      where: { userId_checksum: { userId, checksum } },
      create: {
        userId,
        checksum,
        mimeType: normalized.mimeType,
        data: Uint8Array.from(normalized.data),
      },
      update: {},
    });
    this.artworkCache.set(cacheKey, record.id);
    return record.id;
  }

  private async normalizeArtwork(artwork: { mimeType: string; data: Buffer }) {
    if (!ffmpegPath) return artwork.data.length <= MAX_ARTWORK_BYTES ? artwork : undefined;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-artwork-'));
    const extension = artwork.mimeType.includes('png')
      ? '.png'
      : artwork.mimeType.includes('webp')
        ? '.webp'
        : '.jpg';
    const input = path.join(directory, `input${extension}`);
    const output = path.join(directory, 'cover.jpg');
    try {
      await fs.writeFile(input, artwork.data);
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i',
        input,
        '-vf',
        'scale=1000:1000:force_original_aspect_ratio=decrease',
        '-frames:v',
        '1',
        '-q:v',
        '4',
        output,
      ]);
      const data = await fs.readFile(output);
      return data.length <= MAX_ARTWORK_BYTES ? { mimeType: 'image/jpeg', data } : undefined;
    } catch {
      return artwork.data.length <= MAX_ARTWORK_BYTES ? artwork : undefined;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

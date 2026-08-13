import type { Prisma } from '@prisma/client';
import path from 'node:path';

const MUSIC_CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wma': 'audio/x-ms-wma',
};

export const resolveMusicContentType = (
  fileName: string,
  ...reportedTypes: Array<string | null | undefined>
) => {
  const extensionType = MUSIC_CONTENT_TYPES[path.extname(fileName).toLowerCase()];
  if (extensionType) return extensionType;
  const reported = reportedTypes.find((value) => {
    const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
    return normalized?.startsWith('audio/') && normalized !== 'audio/octet-stream';
  });
  return reported || 'application/octet-stream';
};

export const musicTrackInclude = (userId: string) =>
  ({
    album: { include: { artist: true, artwork: { select: { id: true } } } },
    primaryArtist: { include: { artwork: { select: { id: true } } } },
    artwork: { select: { id: true } },
    artists: {
      orderBy: { position: 'asc' as const },
      include: { artist: { include: { artwork: { select: { id: true } } } } },
    },
    credits: { orderBy: { position: 'asc' as const } },
    favorites: { where: { userId }, select: { id: true } },
    _count: { select: { history: true } },
    driveFile: {
      select: {
        name: true,
        mimeType: true,
        size: true,
        modifiedTime: true,
        storageType: true,
        localFilePath: true,
        googleDriveFileId: true,
        mediaContainer: true,
        audioCodec: true,
        audioChannels: true,
        audioSampleRate: true,
        audioBitrate: true,
        audioBitDepth: true,
        audioLossless: true,
        library: { select: { id: true, name: true, storageType: true } },
      },
    },
  }) satisfies Prisma.MusicTrackInclude;

export type MusicTrackWithRelations = Prisma.MusicTrackGetPayload<{
  include: {
    album: { include: { artist: true; artwork: { select: { id: true } } } };
    primaryArtist: { include: { artwork: { select: { id: true } } } };
    artwork: { select: { id: true } };
    artists: { include: { artist: { include: { artwork: { select: { id: true } } } } } };
    credits: true;
    favorites: { select: { id: true } };
    _count: { select: { history: true } };
    driveFile: {
      select: {
        name: true;
        mimeType: true;
        size: true;
        modifiedTime: true;
        storageType: true;
        localFilePath: true;
        googleDriveFileId: true;
        mediaContainer: true;
        audioCodec: true;
        audioChannels: true;
        audioSampleRate: true;
        audioBitrate: true;
        audioBitDepth: true;
        audioLossless: true;
        library: { select: { id: true; name: true; storageType: true } };
      };
    };
  };
}>;

export const parseGenres = (raw?: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

export const formatMusicArtist = (artist: {
  id: string;
  name: string;
  sortName: string | null;
  musicbrainzId: string | null;
  artwork?: { id: string } | null;
  _count?: { albums: number; trackCredits: number };
}) => ({
  id: artist.id,
  name: artist.name,
  sortName: artist.sortName,
  musicbrainzId: artist.musicbrainzId,
  albumCount: artist._count?.albums,
  trackCount: artist._count?.trackCredits,
  artworkUrl: artist.artwork?.id ? `/api/music/artwork/${artist.artwork.id}` : null,
});

export const formatMusicTrack = (track: MusicTrackWithRelations) => {
  const artworkId = track.artwork?.id || track.album?.artwork?.id;
  return {
    id: track.id,
    title: track.title,
    discNumber: track.discNumber,
    trackNumber: track.trackNumber,
    year: track.year,
    genres: parseGenres(track.genres),
    duration: track.duration,
    album: track.album
      ? {
          id: track.album.id,
          title: track.album.title,
          year: track.album.year,
          genres: parseGenres(track.album.genres),
          releaseType: track.album.releaseType,
          secondaryTypes: parseGenres(track.album.secondaryTypes),
          musicbrainzReleaseId: track.album.musicbrainzReleaseId,
          musicbrainzReleaseGroupId: track.album.musicbrainzReleaseGroupId,
          artist: track.album.artist
            ? {
                id: track.album.artist.id,
                name: track.album.artist.name,
                sortName: track.album.artist.sortName,
                musicbrainzId: track.album.artist.musicbrainzId,
              }
            : null,
          artworkUrl: track.album.artwork?.id
            ? `/api/music/artwork/${track.album.artwork.id}`
            : null,
        }
      : null,
    primaryArtist: track.primaryArtist ? formatMusicArtist(track.primaryArtist) : null,
    artists: track.artists.map(({ artist }) => formatMusicArtist(artist)),
    artworkUrl: artworkId ? `/api/music/artwork/${artworkId}` : null,
    isFavorite: track.favorites.length > 0,
    playCount: track._count.history,
    metadataLocked: track.metadataLocked,
    musicbrainzRecordingId: track.musicbrainzRecordingId,
    credits: track.credits.map((credit) => ({
      id: credit.id,
      name: credit.name,
      role: credit.role,
      instrument: credit.instrument || null,
      musicbrainzId: credit.musicbrainzId,
      source: credit.source,
    })),
    audio: {
      container: track.driveFile.mediaContainer,
      codec: track.driveFile.audioCodec,
      channels: track.driveFile.audioChannels,
      sampleRate: track.driveFile.audioSampleRate,
      bitrate: track.driveFile.audioBitrate,
      bitDepth: track.driveFile.audioBitDepth,
      lossless: track.driveFile.audioLossless,
      replayGainTrackDb: track.replayGainTrackDb,
      replayGainTrackPeak: track.replayGainTrackPeak,
      replayGainAlbumDb: track.replayGainAlbumDb,
      replayGainAlbumPeak: track.replayGainAlbumPeak,
    },
    source: {
      fileName: track.driveFile.name,
      mimeType: track.driveFile.mimeType,
      sizeBytes: track.driveFile.size?.toString() || null,
      modifiedAt: track.driveFile.modifiedTime?.toISOString() || null,
      storageType: track.driveFile.storageType,
      localPath: track.driveFile.localFilePath,
      googleDriveFileId: track.driveFile.googleDriveFileId,
      library: track.driveFile.library,
    },
    streamUrl: `/api/music/tracks/${track.id}/stream`,
    createdAt: track.createdAt.toISOString(),
  };
};

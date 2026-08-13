import type { PrismaClient } from '@prisma/client';
import { MusicBrainzService } from './musicbrainz.service.js';
import { MusicLibraryService } from './music-library.service.js';

const json = (value: unknown) => JSON.stringify(value);
const parseJson = (value: string) => JSON.parse(value) as Record<string, unknown>;
const normalizedName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const audioQuality = (track: {
  id: string;
  audio?: {
    lossless?: boolean | null;
    bitDepth?: number | null;
    sampleRate?: number | null;
    bitrate?: number | null;
    codec?: string | null;
  };
  source?: { sizeBytes?: string | null };
}) => {
  const lossless = track.audio?.lossless ? 100_000 : 0;
  const bitDepth = (track.audio?.bitDepth || 0) * 1000;
  const sampleRate = Math.round((track.audio?.sampleRate || 0) / 10);
  const bitrate = Math.round((track.audio?.bitrate || 0) / 1000);
  const size = Math.min(999, Math.round(Number(track.source?.sizeBytes || 0) / 1_000_000));
  const score = lossless + bitDepth + sampleRate + bitrate + size;
  const label = [
    track.audio?.codec?.toUpperCase(),
    track.audio?.lossless ? 'Lossless' : null,
    track.audio?.bitDepth ? `${track.audio.bitDepth}-bit` : null,
    track.audio?.sampleRate ? `${Math.round(track.audio.sampleRate / 100) / 10} kHz` : null,
    track.audio?.bitrate ? `${Math.round(track.audio.bitrate / 1000)} kbps` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return { trackId: track.id, score, label };
};

export class MusicMaintenanceService {
  private readonly musicbrainz = new MusicBrainzService();
  private readonly library: MusicLibraryService;

  constructor(private readonly prisma: PrismaClient) {
    this.library = new MusicLibraryService(prisma);
  }

  public async generate(
    userId: string,
    input: { trackIds?: string[]; albumIds?: string[]; artistIds?: string[] },
  ) {
    const tracks = await this.prisma.musicTrack.findMany({
      where: {
        library: { userId },
        driveFile: { status: 'active' },
        ...(input.trackIds?.length ? { id: { in: input.trackIds } } : {}),
      },
      include: { primaryArtist: true, album: { include: { artist: true } }, credits: true },
      take: input.trackIds?.length ? 20 : 8,
    });
    const requestedAlbumIds = new Set(input.albumIds || []);
    const albumIds = [
      ...new Set([
        ...requestedAlbumIds,
        ...tracks
          .filter((track) => !track.album?.artworkId)
          .map((track) => track.albumId)
          .filter((id): id is string => !!id),
      ]),
    ].slice(0, 20);
    let generated = 0;
    for (const track of tracks) {
      if (track.metadataLocked || !track.primaryArtist?.name) continue;
      const [recording, album] = await Promise.all([
        this.musicbrainz.enrichRecording({
          recordingId: track.musicbrainzRecordingId,
          title: track.title,
          artist: track.primaryArtist.name,
          album: track.album?.title,
          duration: track.duration,
        }),
        track.album
          ? this.musicbrainz.enrichAlbum(
              track.album.artist?.name || track.primaryArtist.name,
              track.album.title,
            )
          : Promise.resolve(null),
      ]);
      if (!recording && !album) continue;
      const currentData = {
        musicbrainzRecordingId: track.musicbrainzRecordingId,
        year: track.album?.year,
        genres: track.album?.genres,
        musicbrainzReleaseId: track.album?.musicbrainzReleaseId,
        musicbrainzReleaseGroupId: track.album?.musicbrainzReleaseGroupId,
        credits: track.credits
          .filter((credit) => credit.source === 'musicbrainz')
          .map((credit) => ({
            name: credit.name,
            role: credit.role,
            instrument: credit.instrument || '',
            musicbrainzId: credit.musicbrainzId || undefined,
          })),
      };
      const proposedData = {
        musicbrainzRecordingId: recording?.recordingId || track.musicbrainzRecordingId,
        credits: recording?.credits || [],
        albumId: track.albumId,
        year: track.album?.year || album?.year,
        genres:
          track.album?.genres && track.album.genres !== '[]'
            ? track.album.genres
            : JSON.stringify(album?.genres || []),
        musicbrainzReleaseId: track.album?.musicbrainzReleaseId || album?.releaseId,
        musicbrainzReleaseGroupId: track.album?.musicbrainzReleaseGroupId || album?.releaseGroupId,
      };
      const exists = await this.prisma.musicMaintenanceSuggestion.findFirst({
        where: {
          userId,
          targetType: 'track',
          targetId: track.id,
          kind: 'metadata',
          status: 'pending',
        },
      });
      if (!exists) {
        await this.prisma.musicMaintenanceSuggestion.create({
          data: {
            userId,
            targetType: 'track',
            targetId: track.id,
            kind: 'metadata',
            provider: 'musicbrainz',
            confidence: 90,
            currentData: json(currentData),
            proposedData: json(proposedData),
          },
        });
        generated += 1;
      }
    }
    const albums = await this.prisma.musicAlbum.findMany({
      where: { userId, id: { in: albumIds }, artworkId: null },
      include: { artist: true },
    });
    for (const album of albums) {
      if (!album.artist?.name) continue;
      const metadata = await this.musicbrainz.enrichAlbum(album.artist.name, album.title);
      if (!metadata?.artwork) continue;
      const exists = await this.prisma.musicMaintenanceSuggestion.findFirst({
        where: {
          userId,
          targetType: 'album',
          targetId: album.id,
          kind: 'artwork',
          status: 'pending',
        },
      });
      if (!exists) {
        await this.prisma.musicMaintenanceSuggestion.create({
          data: {
            userId,
            targetType: 'album',
            targetId: album.id,
            kind: 'artwork',
            provider: 'cover-art-archive',
            confidence: 90,
            currentData: json({ artworkId: album.artworkId }),
            proposedData: json({
              releaseGroupId: metadata.releaseGroupId,
              previewUrl: `https://coverartarchive.org/release-group/${metadata.releaseGroupId}/front-500`,
            }),
          },
        });
        generated += 1;
      }
    }
    const identityCandidates = await this.prisma.musicArtist.findMany({
      where: {
        userId,
        musicbrainzId: null,
        ...(input.artistIds?.length
          ? { id: { in: input.artistIds } }
          : {
              OR: [
                {
                  trackCredits: {
                    some: { track: { library: { userId }, driveFile: { status: 'active' } } },
                  },
                },
                {
                  albums: {
                    some: {
                      tracks: {
                        some: { library: { userId }, driveFile: { status: 'active' } },
                      },
                    },
                  },
                },
              ],
            }),
      },
      take: input.artistIds?.length ? 20 : 8,
    });
    let matchedArtists = 0;
    for (const artist of identityCandidates) {
      const identity = await this.musicbrainz.matchArtistIdentity(artist.name);
      if (!identity) continue;
      const updated = await this.prisma.musicArtist.updateMany({
        where: { id: artist.id, userId, musicbrainzId: null },
        data: {
          musicbrainzId: identity.musicbrainzId,
          sortName: artist.sortName || identity.sortName,
        },
      });
      matchedArtists += updated.count;
    }

    const artists = await this.prisma.musicArtist.findMany({
      where: {
        userId,
        musicbrainzId: { not: null },
        ...(input.artistIds?.length
          ? { id: { in: input.artistIds } }
          : { artworkId: null, artworkLocked: false }),
      },
      take: input.artistIds?.length ? 20 : 8,
    });
    for (const artist of artists) {
      if (!artist.musicbrainzId) continue;
      const exists = await this.prisma.musicMaintenanceSuggestion.findFirst({
        where: {
          userId,
          targetType: 'artist',
          targetId: artist.id,
          kind: 'artwork',
          status: 'pending',
        },
      });
      if (exists) continue;
      const metadata = await this.musicbrainz.enrichArtistArtwork(artist.musicbrainzId);
      if (!metadata) continue;
      await this.prisma.musicMaintenanceSuggestion.create({
        data: {
          userId,
          targetType: 'artist',
          targetId: artist.id,
          kind: 'artwork',
          provider: 'wikimedia-commons',
          confidence: 95,
          currentData: json({
            artworkId: artist.artworkId,
            artworkSource: artist.artworkSource,
            artworkSourceUrl: artist.artworkSourceUrl,
            artworkAttribution: artist.artworkAttribution,
            artworkLicense: artist.artworkLicense,
            artworkLocked: artist.artworkLocked,
          }),
          proposedData: json({
            musicbrainzId: artist.musicbrainzId,
            wikidataId: metadata.wikidataId,
            previewUrl: metadata.previewUrl,
            sourceUrl: metadata.sourceUrl,
            attribution: metadata.attribution,
            license: metadata.license,
          }),
        },
      });
      generated += 1;
    }
    return { generated, matchedArtists };
  }

  public async resolve(userId: string, suggestionId: string, accept: boolean) {
    const suggestion = await this.prisma.musicMaintenanceSuggestion.findFirst({
      where: { id: suggestionId, userId, status: 'pending' },
    });
    if (!suggestion) return null;
    if (!accept) {
      await this.prisma.musicMaintenanceSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'rejected', resolvedAt: new Date() },
      });
      return { status: 'rejected' };
    }
    const proposed = parseJson(suggestion.proposedData);
    if (suggestion.kind === 'acoustic-metadata' && suggestion.targetType === 'track') {
      const track = await this.prisma.musicTrack.findFirst({
        where: { id: suggestion.targetId, library: { userId } },
        include: { primaryArtist: true },
      });
      if (!track) return null;
      const title = (proposed.title as string | undefined) || track.title;
      const artistName = proposed.artist as string | undefined;
      await this.prisma.$transaction(async (tx) => {
        let artistId = track.primaryArtistId;
        if (artistName) {
          const artist = await tx.musicArtist.upsert({
            where: {
              userId_normalizedName: { userId, normalizedName: normalizedName(artistName) },
            },
            create: { userId, name: artistName, normalizedName: normalizedName(artistName) },
            update: { name: artistName },
          });
          artistId = artist.id;
        }
        await tx.musicTrack.update({
          where: { id: track.id },
          data: {
            title,
            normalizedTitle: normalizedName(title),
            primaryArtistId: artistId,
            musicbrainzRecordingId:
              (proposed.musicbrainzRecordingId as string | undefined) || undefined,
            metadataLocked: true,
          },
        });
        if (artistId) {
          await tx.musicTrackArtist.deleteMany({ where: { trackId: track.id } });
          await tx.musicTrackArtist.create({ data: { trackId: track.id, artistId, position: 0 } });
        }
        await tx.musicMaintenanceAction.create({
          data: {
            userId,
            actionType: 'accept-acoustic-metadata',
            targetType: 'track',
            targetId: track.id,
            beforeData: suggestion.currentData,
            afterData: suggestion.proposedData,
          },
        });
        await tx.musicMaintenanceSuggestion.update({
          where: { id: suggestion.id },
          data: { status: 'accepted', resolvedAt: new Date() },
        });
      });
    } else if (suggestion.kind === 'metadata' && suggestion.targetType === 'track') {
      const track = await this.prisma.musicTrack.findFirst({
        where: { id: suggestion.targetId, library: { userId } },
        include: { album: true, credits: true },
      });
      if (!track) return null;
      await this.prisma.$transaction(async (tx) => {
        await tx.musicTrack.update({
          where: { id: track.id },
          data: {
            musicbrainzRecordingId:
              (proposed.musicbrainzRecordingId as string | undefined) || undefined,
          },
        });
        if (track.albumId)
          await tx.musicAlbum.update({
            where: { id: track.albumId },
            data: {
              year: (proposed.year as number | undefined) || undefined,
              genres: (proposed.genres as string | undefined) || undefined,
              musicbrainzReleaseId:
                (proposed.musicbrainzReleaseId as string | undefined) || undefined,
              musicbrainzReleaseGroupId:
                (proposed.musicbrainzReleaseGroupId as string | undefined) || undefined,
              metadataStatus: 'enriched',
            },
          });
        const credits = Array.isArray(proposed.credits)
          ? (proposed.credits as Array<{
              name: string;
              role: string;
              instrument?: string;
              musicbrainzId?: string;
            }>)
          : [];
        if (credits.length) {
          await tx.musicTrackCredit.deleteMany({
            where: { trackId: track.id, source: 'musicbrainz' },
          });
          await tx.musicTrackCredit.createMany({
            data: credits.map((credit, position) => ({
              trackId: track.id,
              ...credit,
              instrument: credit.instrument || '',
              source: 'musicbrainz',
              position,
            })),
          });
        }
        await tx.musicMaintenanceAction.create({
          data: {
            userId,
            actionType: 'accept-metadata',
            targetType: 'track',
            targetId: track.id,
            beforeData: suggestion.currentData,
            afterData: suggestion.proposedData,
          },
        });
        await tx.musicMaintenanceSuggestion.update({
          where: { id: suggestion.id },
          data: { status: 'accepted', resolvedAt: new Date() },
        });
      });
    } else if (suggestion.kind === 'artwork' && suggestion.targetType === 'album') {
      const album = await this.prisma.musicAlbum.findFirst({
        where: { id: suggestion.targetId, userId },
      });
      const releaseGroupId = proposed.releaseGroupId as string | undefined;
      if (!album || !releaseGroupId) return null;
      const artwork = await this.musicbrainz.fetchCoverArtwork(releaseGroupId);
      if (!artwork) throw new Error('ARTWORK_UNAVAILABLE');
      const artworkId = await this.library.saveArtwork(userId, artwork);
      await this.prisma.$transaction([
        this.prisma.musicAlbum.update({ where: { id: album.id }, data: { artworkId } }),
        this.prisma.musicMaintenanceAction.create({
          data: {
            userId,
            actionType: 'accept-artwork',
            targetType: 'album',
            targetId: album.id,
            beforeData: json({ artworkId: album.artworkId }),
            afterData: json({ artworkId }),
          },
        }),
        this.prisma.musicMaintenanceSuggestion.update({
          where: { id: suggestion.id },
          data: { status: 'accepted', resolvedAt: new Date() },
        }),
      ]);
    } else if (suggestion.kind === 'artwork' && suggestion.targetType === 'artist') {
      const artist = await this.prisma.musicArtist.findFirst({
        where: { id: suggestion.targetId, userId },
      });
      const musicbrainzId = proposed.musicbrainzId as string | undefined;
      if (!artist || !musicbrainzId) return null;
      const metadata = await this.musicbrainz.enrichArtistArtwork(musicbrainzId);
      if (!metadata) throw new Error('ARTIST_ARTWORK_UNAVAILABLE');
      const artworkId = await this.library.saveArtwork(userId, metadata.artwork);
      if (!artworkId) throw new Error('ARTIST_ARTWORK_UNAVAILABLE');
      const beforeData = json({
        artworkId: artist.artworkId,
        artworkSource: artist.artworkSource,
        artworkSourceUrl: artist.artworkSourceUrl,
        artworkAttribution: artist.artworkAttribution,
        artworkLicense: artist.artworkLicense,
        artworkLocked: artist.artworkLocked,
      });
      const afterData = json({
        artworkId,
        artworkSource: 'wikimedia-commons',
        artworkSourceUrl: metadata.sourceUrl,
        artworkAttribution: metadata.attribution,
        artworkLicense: metadata.license,
        artworkLocked: false,
      });
      await this.prisma.$transaction([
        this.prisma.musicArtist.update({
          where: { id: artist.id },
          data: {
            artworkId,
            artworkSource: 'wikimedia-commons',
            artworkSourceUrl: metadata.sourceUrl,
            artworkAttribution: metadata.attribution,
            artworkLicense: metadata.license,
            artworkLocked: false,
          },
        }),
        this.prisma.musicMaintenanceAction.create({
          data: {
            userId,
            actionType: 'accept-artist-artwork',
            targetType: 'artist',
            targetId: artist.id,
            beforeData,
            afterData,
          },
        }),
        this.prisma.musicMaintenanceSuggestion.update({
          where: { id: suggestion.id },
          data: { status: 'accepted', resolvedAt: new Date() },
        }),
      ]);
    }
    return { status: 'accepted' };
  }

  public async updateArtist(
    userId: string,
    artistId: string,
    input: {
      name: string;
      sortName?: string | null;
      artworkData?: string;
      removeArtwork?: boolean;
    },
  ) {
    const artist = await this.prisma.musicArtist.findFirst({ where: { id: artistId, userId } });
    if (!artist) return null;
    let artworkId: string | null | undefined;
    if (input.removeArtwork) {
      artworkId = null;
    } else if (input.artworkData) {
      const match = input.artworkData.match(
        /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) throw new Error('INVALID_ARTIST_ARTWORK');
      const data = Buffer.from(match[2]!, 'base64');
      if (!data.length || data.length > 6 * 1024 * 1024) throw new Error('INVALID_ARTIST_ARTWORK');
      artworkId = (await this.library.saveArtwork(userId, { mimeType: match[1]!, data })) || null;
      if (!artworkId) throw new Error('INVALID_ARTIST_ARTWORK');
    }
    const artworkChanged = artworkId !== undefined;
    const beforeData = json({
      name: artist.name,
      sortName: artist.sortName,
      artworkId: artist.artworkId,
      artworkSource: artist.artworkSource,
      artworkSourceUrl: artist.artworkSourceUrl,
      artworkAttribution: artist.artworkAttribution,
      artworkLicense: artist.artworkLicense,
      artworkLocked: artist.artworkLocked,
    });
    const updated = await this.prisma.musicArtist.update({
      where: { id: artist.id },
      data: {
        name: input.name,
        normalizedName: normalizedName(input.name),
        sortName: input.sortName,
        ...(artworkChanged
          ? {
              artworkId,
              artworkSource: artworkId ? 'manual' : null,
              artworkSourceUrl: null,
              artworkAttribution: null,
              artworkLicense: null,
              artworkLocked: true,
            }
          : {}),
      },
    });
    await this.prisma.musicMaintenanceAction.create({
      data: {
        userId,
        actionType: artworkChanged ? 'set-artist-artwork' : 'edit-artist',
        targetType: 'artist',
        targetId: artist.id,
        beforeData,
        afterData: json({
          name: updated.name,
          sortName: updated.sortName,
          artworkId: updated.artworkId,
          artworkSource: updated.artworkSource,
          artworkSourceUrl: updated.artworkSourceUrl,
          artworkAttribution: updated.artworkAttribution,
          artworkLicense: updated.artworkLicense,
          artworkLocked: updated.artworkLocked,
        }),
      },
    });
    return updated;
  }

  public async archiveDuplicate(
    userId: string,
    input: { keepTrackId: string; archiveTrackId: string; replacePlaylistItems: boolean },
  ) {
    if (input.keepTrackId === input.archiveTrackId) return null;
    const tracks = await this.prisma.musicTrack.findMany({
      where: { id: { in: [input.keepTrackId, input.archiveTrackId] }, library: { userId } },
      include: { driveFile: true },
    });
    if (tracks.length !== 2) return null;
    const archived = tracks.find((track) => track.id === input.archiveTrackId)!;
    const playlistItems = input.replacePlaylistItems
      ? await this.prisma.musicPlaylistItem.findMany({
          where: { trackId: archived.id, playlist: { userId } },
          select: { id: true, trackId: true },
        })
      : [];
    await this.prisma.$transaction(async (tx) => {
      await tx.driveFile.update({
        where: { id: archived.driveFileId },
        data: { status: 'archived' },
      });
      for (const item of playlistItems)
        await tx.musicPlaylistItem.update({
          where: { id: item.id },
          data: { trackId: input.keepTrackId },
        });
      await tx.musicMaintenanceAction.create({
        data: {
          userId,
          actionType: 'archive-duplicate',
          targetType: 'track',
          targetId: archived.id,
          beforeData: json({
            driveFileId: archived.driveFileId,
            status: archived.driveFile.status,
            playlistItems,
          }),
          afterData: json({ status: 'archived', keepTrackId: input.keepTrackId }),
        },
      });
    });
    return { archivedTrackId: archived.id, replacedPlaylistItems: playlistItems.length };
  }

  public async undo(userId: string, actionId: string) {
    const action = await this.prisma.musicMaintenanceAction.findFirst({
      where: { id: actionId, userId, revertedAt: null },
    });
    if (!action) return null;
    const before = parseJson(action.beforeData);
    await this.prisma.$transaction(async (tx) => {
      if (action.actionType === 'archive-duplicate') {
        await tx.driveFile.update({
          where: { id: before.driveFileId as string },
          data: { status: (before.status as string) || 'active' },
        });
        for (const item of (before.playlistItems as
          Array<{ id: string; trackId: string }> | undefined) || [])
          await tx.musicPlaylistItem.update({
            where: { id: item.id },
            data: { trackId: item.trackId },
          });
      } else if (action.actionType === 'accept-artwork') {
        await tx.musicAlbum.update({
          where: { id: action.targetId },
          data: { artworkId: (before.artworkId as string | null) || null },
        });
      } else if (
        ['accept-artist-artwork', 'set-artist-artwork', 'edit-artist'].includes(action.actionType)
      ) {
        await tx.musicArtist.update({
          where: { id: action.targetId },
          data: {
            name: (before.name as string | undefined) || undefined,
            normalizedName: before.name ? normalizedName(before.name as string) : undefined,
            sortName: (before.sortName as string | null | undefined) ?? undefined,
            artworkId: (before.artworkId as string | null | undefined) ?? null,
            artworkSource: (before.artworkSource as string | null | undefined) ?? null,
            artworkSourceUrl: (before.artworkSourceUrl as string | null | undefined) ?? null,
            artworkAttribution: (before.artworkAttribution as string | null | undefined) ?? null,
            artworkLicense: (before.artworkLicense as string | null | undefined) ?? null,
            artworkLocked: (before.artworkLocked as boolean | undefined) || false,
          },
        });
      } else if (action.actionType === 'accept-metadata') {
        await tx.musicTrack.update({
          where: { id: action.targetId },
          data: {
            musicbrainzRecordingId: (before.musicbrainzRecordingId as string | null) || null,
          },
        });
        const track = await tx.musicTrack.findUnique({ where: { id: action.targetId } });
        if (track?.albumId)
          await tx.musicAlbum.update({
            where: { id: track.albumId },
            data: {
              year: (before.year as number | null) || null,
              genres: (before.genres as string | null) || null,
              musicbrainzReleaseId: (before.musicbrainzReleaseId as string | null) || null,
              musicbrainzReleaseGroupId:
                (before.musicbrainzReleaseGroupId as string | null) || null,
            },
          });
        await tx.musicTrackCredit.deleteMany({
          where: { trackId: action.targetId, source: 'musicbrainz' },
        });
        const previousCredits =
          (before.credits as
            | Array<{ name: string; role: string; instrument?: string; musicbrainzId?: string }>
            | undefined) || [];
        if (previousCredits.length)
          await tx.musicTrackCredit.createMany({
            data: previousCredits.map((credit, position) => ({
              trackId: action.targetId,
              ...credit,
              instrument: credit.instrument || '',
              source: 'musicbrainz',
              position,
            })),
          });
      } else if (action.actionType === 'accept-acoustic-metadata') {
        const title = before.title as string;
        const artistId = (before.primaryArtistId as string | null) || null;
        await tx.musicTrack.update({
          where: { id: action.targetId },
          data: {
            title,
            normalizedTitle: normalizedName(title),
            primaryArtistId: artistId,
            musicbrainzRecordingId: (before.musicbrainzRecordingId as string | null) || null,
            metadataLocked: false,
          },
        });
        await tx.musicTrackArtist.deleteMany({ where: { trackId: action.targetId } });
        if (artistId)
          await tx.musicTrackArtist.create({
            data: { trackId: action.targetId, artistId, position: 0 },
          });
      }
      await tx.musicMaintenanceAction.update({
        where: { id: action.id },
        data: { revertedAt: new Date() },
      });
    });
    return { reverted: true };
  }
}

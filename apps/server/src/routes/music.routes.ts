import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  addMusicPlaylistItemSchema,
  createMusicHistorySchema,
  createMusicPlaylistSchema,
  musicListQuerySchema,
  reorderMusicPlaylistSchema,
  updateMusicLyricsSchema,
  updateMusicTrackMetadataSchema,
  updateMusicPlaybackStateSchema,
  updateMusicPlaylistSchema,
} from '@cinedrive/shared';
import { resolveRangeRequest } from '../utils/http-range.js';
import { formatMusicTrack, musicTrackInclude, parseGenres } from '../utils/music-format.js';
import { driveSourceInput } from './media/shared.js';
import { MusicLyricsService, parseLrc } from '../services/music-lyrics.service.js';
import { MusicBrainzService } from '../services/musicbrainz.service.js';

const normalizeMusicName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const ownedTrackWhere = (userId: string): Prisma.MusicTrackWhereInput => ({
  library: { userId },
});

const formatLyrics = (lyrics: {
  trackId: string;
  content: string;
  sourceName: string;
  language: string | null;
  updatedAt: Date;
}) => {
  const parsed = parseLrc(lyrics.content);
  return {
    trackId: lyrics.trackId,
    sourceName: lyrics.sourceName,
    language: lyrics.language,
    isSynced: parsed.isSynced,
    offsetMs: parsed.offsetMs,
    lines: parsed.lines,
    updatedAt: lyrics.updatedAt.toISOString(),
  };
};

const albumDto = (album: {
  id: string;
  title: string;
  year: number | null;
  genres: string | null;
  releaseType: string;
  secondaryTypes: string | null;
  musicbrainzReleaseId: string | null;
  musicbrainzReleaseGroupId: string | null;
  artwork: { id: string } | null;
  artist: {
    id: string;
    name: string;
    sortName: string | null;
    musicbrainzId: string | null;
  } | null;
  _count?: { tracks: number };
}) => ({
  id: album.id,
  title: album.title,
  year: album.year,
  genres: parseGenres(album.genres),
  releaseType: album.releaseType,
  secondaryTypes: parseGenres(album.secondaryTypes),
  musicbrainzReleaseId: album.musicbrainzReleaseId,
  musicbrainzReleaseGroupId: album.musicbrainzReleaseGroupId,
  artworkUrl: album.artwork ? `/api/music/artwork/${album.artwork.id}` : null,
  artist: album.artist,
  trackCount: album._count?.tracks,
});

export const musicRoutes: FastifyPluginAsync = async (fastify) => {
  const lyricsService = new MusicLyricsService(fastify.prisma);
  const musicbrainz = new MusicBrainzService();
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/overview', async (request) => {
    const userId = request.user!.id;
    const trackWhere = ownedTrackWhere(userId);
    const [tracks, albums, artists, playlists, recentHistory, favoriteCount] = await Promise.all([
      fastify.prisma.musicTrack.findMany({
        where: trackWhere,
        include: musicTrackInclude(userId),
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      fastify.prisma.musicAlbum.findMany({
        where: { userId, tracks: { some: trackWhere } },
        include: {
          artwork: { select: { id: true } },
          artist: true,
          _count: { select: { tracks: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      fastify.prisma.musicArtist.findMany({
        where: { userId, trackCredits: { some: { track: trackWhere } } },
        include: {
          _count: { select: { albums: true, trackCredits: true } },
          albums: { where: { artworkId: { not: null } }, select: { artworkId: true }, take: 1 },
        },
        orderBy: { name: 'asc' },
        take: 12,
      }),
      fastify.prisma.musicPlaylist.findMany({
        where: { userId },
        include: { items: { include: { track: { select: { duration: true } } } } },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
      fastify.prisma.musicHistory.findMany({
        where: { userId },
        include: { track: { include: musicTrackInclude(userId) } },
        orderBy: { playedAt: 'desc' },
        take: 12,
      }),
      fastify.prisma.musicFavorite.count({ where: { userId } }),
    ]);
    return {
      recentTracks: tracks.map(formatMusicTrack),
      recentAlbums: albums.map(albumDto),
      artists: artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        sortName: artist.sortName,
        musicbrainzId: artist.musicbrainzId,
        albumCount: artist._count.albums,
        trackCount: artist._count.trackCredits,
        artworkUrl: artist.albums[0]?.artworkId
          ? `/api/music/artwork/${artist.albums[0].artworkId}`
          : null,
      })),
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        itemCount: playlist.items.length,
        duration: playlist.items.reduce((total, item) => total + (item.track.duration || 0), 0),
        updatedAt: playlist.updatedAt.toISOString(),
      })),
      recentHistory: recentHistory.map((entry) => ({
        id: entry.id,
        playedAt: entry.playedAt.toISOString(),
        listenedSeconds: entry.listenedSeconds,
        track: formatMusicTrack(entry.track),
      })),
      favoriteCount,
    };
  });

  fastify.get('/tracks', async (request, reply) => {
    const parsed = musicListQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz müzik sorgusu.',
          requestId: request.id,
        },
      });
    const query = parsed.data;
    const where: Prisma.MusicTrackWhereInput = { ...ownedTrackWhere(request.user!.id) };
    if (query.artistId) where.artists = { some: { artistId: query.artistId } };
    if (query.albumId) where.albumId = query.albumId;
    if (query.search)
      where.OR = [
        { title: { contains: query.search } },
        { primaryArtist: { name: { contains: query.search } } },
        { album: { title: { contains: query.search } } },
      ];
    const orderBy: Prisma.MusicTrackOrderByWithRelationInput =
      query.sortBy === 'artist'
        ? { primaryArtist: { name: query.sortOrder } }
        : query.sortBy === 'album'
          ? { album: { title: query.sortOrder } }
          : { [query.sortBy]: query.sortOrder };
    const [tracks, total] = await Promise.all([
      fastify.prisma.musicTrack.findMany({
        where,
        include: musicTrackInclude(request.user!.id),
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      fastify.prisma.musicTrack.count({ where }),
    ]);
    return {
      tracks: tracks.map(formatMusicTrack),
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  });

  fastify.get<{ Params: { id: string } }>('/tracks/:id', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      include: musicTrackInclude(request.user!.id),
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    return { track: formatMusicTrack(track) };
  });

  fastify.patch<{ Params: { id: string } }>('/tracks/:id/metadata', async (request, reply) => {
    const parsed = updateMusicTrackMetadataSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz parça metadata bilgisi.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const existing = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(userId) },
      include: { album: true },
    });
    if (!existing)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    const input = parsed.data;
    await fastify.prisma.$transaction(async (transaction) => {
      const primaryArtist = await transaction.musicArtist.upsert({
        where: {
          userId_normalizedName: {
            userId,
            normalizedName: normalizeMusicName(input.artist),
          },
        },
        create: { userId, name: input.artist, normalizedName: normalizeMusicName(input.artist) },
        update: { name: input.artist },
      });
      const albumArtistName = input.albumArtist || input.artist;
      const albumArtist = await transaction.musicArtist.upsert({
        where: {
          userId_normalizedName: {
            userId,
            normalizedName: normalizeMusicName(albumArtistName),
          },
        },
        create: {
          userId,
          name: albumArtistName,
          normalizedName: normalizeMusicName(albumArtistName),
        },
        update: { name: albumArtistName },
      });
      const album = await transaction.musicAlbum.upsert({
        where: {
          userId_artistId_normalizedTitle: {
            userId,
            artistId: albumArtist.id,
            normalizedTitle: normalizeMusicName(input.album),
          },
        },
        create: {
          userId,
          artistId: albumArtist.id,
          artworkId: existing.album?.artworkId,
          title: input.album,
          normalizedTitle: normalizeMusicName(input.album),
          year: input.year,
          genres: JSON.stringify(input.genres),
          releaseType: input.releaseType.toLowerCase(),
          metadataStatus: 'manual',
        },
        update: {
          title: input.album,
          year: input.year,
          genres: JSON.stringify(input.genres),
          releaseType: input.releaseType.toLowerCase(),
          metadataStatus: 'manual',
        },
      });
      await transaction.musicTrack.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          normalizedTitle: normalizeMusicName(input.title),
          primaryArtistId: primaryArtist.id,
          albumId: album.id,
          year: input.year,
          genres: JSON.stringify(input.genres),
          discNumber: input.discNumber,
          trackNumber: input.trackNumber,
          metadataLocked: input.metadataLocked,
        },
      });
      await transaction.musicTrackArtist.deleteMany({ where: { trackId: existing.id } });
      await transaction.musicTrackArtist.create({
        data: { trackId: existing.id, artistId: primaryArtist.id, position: 0 },
      });
      if (input.credits) {
        await transaction.musicTrackCredit.deleteMany({ where: { trackId: existing.id } });
        if (input.credits.length)
          await transaction.musicTrackCredit.createMany({
            data: input.credits.map((credit, position) => ({
              trackId: existing.id,
              name: credit.name,
              role: credit.role.toLowerCase(),
              instrument: credit.instrument || '',
              musicbrainzId: credit.musicbrainzId,
              source: 'manual',
              position,
            })),
          });
      }
    });
    const track = await fastify.prisma.musicTrack.findUniqueOrThrow({
      where: { id: existing.id },
      include: musicTrackInclude(userId),
    });
    return { track: formatMusicTrack(track) };
  });

  fastify.post<{ Params: { id: string } }>('/tracks/:id/rematch', async (request, reply) => {
    const userId = request.user!.id;
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(userId) },
      include: { primaryArtist: true, album: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    const artistName = track.primaryArtist?.name || '';
    if (!artistName)
      return reply.status(422).send({
        error: {
          code: 'INSUFFICIENT_METADATA',
          message: 'MusicBrainz eşleştirmesi için sanatçı bilgisi gerekli.',
          requestId: request.id,
        },
      });
    const [recording, albumMetadata] = await Promise.all([
      musicbrainz.enrichRecording({
        recordingId: track.musicbrainzRecordingId,
        title: track.title,
        artist: artistName,
        album: track.album?.title,
        duration: track.duration,
      }),
      track.album ? musicbrainz.enrichAlbum(artistName, track.album.title) : Promise.resolve(null),
    ]);
    if (!recording && !albumMetadata) return { matchStatus: 'not_found', track: null };
    await fastify.prisma.$transaction(async (transaction) => {
      if (recording) {
        await transaction.musicTrack.update({
          where: { id: track.id },
          data: { musicbrainzRecordingId: recording.recordingId },
        });
        await transaction.musicTrackCredit.deleteMany({
          where: { trackId: track.id, source: 'musicbrainz' },
        });
        const existingCredits = await transaction.musicTrackCredit.findMany({
          where: { trackId: track.id },
          select: { name: true, role: true, instrument: true },
        });
        const newCredits = recording.credits.filter(
          (credit) =>
            !existingCredits.some(
              (existingCredit) =>
                existingCredit.name === credit.name &&
                existingCredit.role === credit.role &&
                (existingCredit.instrument || '') === (credit.instrument || ''),
            ),
        );
        if (newCredits.length)
          await transaction.musicTrackCredit.createMany({
            data: newCredits.map((credit, position) => ({
              trackId: track.id,
              name: credit.name,
              role: credit.role,
              instrument: credit.instrument || '',
              musicbrainzId: credit.musicbrainzId,
              source: 'musicbrainz',
              position: existingCredits.length + position,
            })),
          });
      }
      if (track.album && albumMetadata) {
        await transaction.musicAlbum.update({
          where: { id: track.album.id },
          data: {
            musicbrainzReleaseId: track.album.musicbrainzReleaseId || albumMetadata.releaseId,
            musicbrainzReleaseGroupId:
              track.album.musicbrainzReleaseGroupId || albumMetadata.releaseGroupId,
            releaseType: albumMetadata.releaseType || track.album.releaseType,
            secondaryTypes: albumMetadata.secondaryTypes.length
              ? JSON.stringify(albumMetadata.secondaryTypes)
              : track.album.secondaryTypes,
            metadataStatus: 'enriched',
          },
        });
      }
    });
    const updated = await fastify.prisma.musicTrack.findUniqueOrThrow({
      where: { id: track.id },
      include: musicTrackInclude(userId),
    });
    return { matchStatus: 'matched', track: formatMusicTrack(updated) };
  });

  fastify.get('/albums', async (request, reply) => {
    const parsed = musicListQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz albüm sorgusu.',
          requestId: request.id,
        },
      });
    const { search, artistId, page, limit, sortOrder } = parsed.data;
    const where: Prisma.MusicAlbumWhereInput = {
      userId: request.user!.id,
      tracks: { some: ownedTrackWhere(request.user!.id) },
      ...(artistId ? { artistId } : {}),
      ...(search
        ? { OR: [{ title: { contains: search } }, { artist: { name: { contains: search } } }] }
        : {}),
    };
    const [albums, total] = await Promise.all([
      fastify.prisma.musicAlbum.findMany({
        where,
        include: {
          artwork: { select: { id: true } },
          artist: true,
          _count: { select: { tracks: true } },
        },
        orderBy: { title: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      fastify.prisma.musicAlbum.count({ where }),
    ]);
    return {
      albums: albums.map(albumDto),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  });

  fastify.get<{ Params: { id: string } }>('/albums/:id', async (request, reply) => {
    const userId = request.user!.id;
    const album = await fastify.prisma.musicAlbum.findFirst({
      where: { id: request.params.id, userId, tracks: { some: ownedTrackWhere(userId) } },
      include: {
        artwork: { select: { id: true } },
        artist: true,
        _count: { select: { tracks: true } },
        tracks: {
          where: ownedTrackWhere(userId),
          include: musicTrackInclude(userId),
          orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }, { title: 'asc' }],
        },
      },
    });
    if (!album)
      return reply.status(404).send({
        error: { code: 'ALBUM_NOT_FOUND', message: 'Albüm bulunamadı.', requestId: request.id },
      });
    const albumGenres = new Set(parseGenres(album.genres).map((genre) => genre.toLowerCase()));
    const candidates = albumGenres.size
      ? await fastify.prisma.musicAlbum.findMany({
          where: {
            id: { not: album.id },
            userId,
            tracks: { some: ownedTrackWhere(userId) },
          },
          include: {
            artwork: { select: { id: true } },
            artist: true,
            _count: { select: { tracks: true } },
          },
          take: 60,
        })
      : [];
    const similarAlbums = candidates
      .map((candidate) => ({
        album: candidate,
        score: parseGenres(candidate.genres).filter((genre) => albumGenres.has(genre.toLowerCase()))
          .length,
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map(({ album: candidate }) => albumDto(candidate));
    const formats = [
      ...new Set(
        album.tracks
          .map((track) => track.driveFile.audioCodec || track.driveFile.mediaContainer)
          .filter((format): format is string => !!format)
          .map((format) => format.toUpperCase()),
      ),
    ];
    return {
      album: {
        ...albumDto(album),
        tracks: album.tracks.map(formatMusicTrack),
        totalDuration: album.tracks.reduce((total, track) => total + (track.duration || 0), 0),
        discCount: Math.max(1, ...album.tracks.map((track) => track.discNumber)),
        qualitySummary: {
          formats,
          lossless: album.tracks.some((track) => track.driveFile.audioLossless),
          hiRes: album.tracks.some(
            (track) =>
              track.driveFile.audioLossless &&
              ((track.driveFile.audioBitDepth || 0) > 16 ||
                (track.driveFile.audioSampleRate || 0) > 48_000),
          ),
        },
        similarAlbums,
      },
    };
  });

  fastify.get('/artists', async (request) => {
    const userId = request.user!.id;
    const artists = await fastify.prisma.musicArtist.findMany({
      where: { userId, trackCredits: { some: { track: ownedTrackWhere(userId) } } },
      include: {
        _count: { select: { albums: true, trackCredits: true } },
        albums: { where: { artworkId: { not: null } }, select: { artworkId: true }, take: 1 },
      },
      orderBy: { name: 'asc' },
    });
    return {
      artists: artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        sortName: artist.sortName,
        musicbrainzId: artist.musicbrainzId,
        albumCount: artist._count.albums,
        trackCount: artist._count.trackCredits,
        artworkUrl: artist.albums[0]?.artworkId
          ? `/api/music/artwork/${artist.albums[0].artworkId}`
          : null,
      })),
    };
  });

  fastify.get<{ Params: { id: string } }>('/artists/:id', async (request, reply) => {
    const userId = request.user!.id;
    const artist = await fastify.prisma.musicArtist.findFirst({
      where: {
        id: request.params.id,
        userId,
        trackCredits: { some: { track: ownedTrackWhere(userId) } },
      },
      include: {
        albums: {
          where: { tracks: { some: ownedTrackWhere(userId) } },
          include: {
            artwork: { select: { id: true } },
            artist: true,
            _count: { select: { tracks: true } },
          },
          orderBy: { year: 'desc' },
        },
        trackCredits: {
          where: { track: ownedTrackWhere(userId) },
          include: { track: { include: musicTrackInclude(userId) } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!artist)
      return reply.status(404).send({
        error: {
          code: 'ARTIST_NOT_FOUND',
          message: 'Sanatçı bulunamadı.',
          requestId: request.id,
        },
      });
    const artistGenres = new Set(
      artist.trackCredits
        .flatMap((credit) => parseGenres(credit.track.genres))
        .map((genre) => genre.toLowerCase()),
    );
    const candidates = artistGenres.size
      ? await fastify.prisma.musicArtist.findMany({
          where: {
            id: { not: artist.id },
            userId,
            trackCredits: { some: { track: ownedTrackWhere(userId) } },
          },
          include: {
            _count: { select: { albums: true, trackCredits: true } },
            albums: { where: { artworkId: { not: null } }, select: { artworkId: true }, take: 1 },
            trackCredits: {
              where: { track: ownedTrackWhere(userId) },
              select: { track: { select: { genres: true } } },
            },
          },
          take: 60,
        })
      : [];
    const similarArtists = candidates
      .map((candidate) => ({
        artist: candidate,
        score: new Set(
          candidate.trackCredits
            .flatMap((credit) => parseGenres(credit.track.genres))
            .map((genre) => genre.toLowerCase()),
        ),
      }))
      .map(({ artist: candidate, score: genres }) => ({
        artist: candidate,
        score: [...genres].filter((genre) => artistGenres.has(genre)).length,
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map(({ artist: candidate }) => ({
        id: candidate.id,
        name: candidate.name,
        sortName: candidate.sortName,
        musicbrainzId: candidate.musicbrainzId,
        albumCount: candidate._count.albums,
        trackCount: candidate._count.trackCredits,
        artworkUrl: candidate.albums[0]?.artworkId
          ? `/api/music/artwork/${candidate.albums[0].artworkId}`
          : null,
      }));
    return {
      artist: {
        id: artist.id,
        name: artist.name,
        sortName: artist.sortName,
        musicbrainzId: artist.musicbrainzId,
        artworkUrl: artist.albums.find((album) => album.artworkId)?.artworkId
          ? `/api/music/artwork/${artist.albums.find((album) => album.artworkId)!.artworkId}`
          : null,
        albums: artist.albums.map(albumDto),
        tracks: artist.trackCredits.map((credit) => formatMusicTrack(credit.track)),
        similarArtists,
      },
    };
  });

  fastify.get('/search', async (request) => {
    const userId = request.user!.id;
    const q = String((request.query as { q?: string }).q || '').trim();
    if (!q) return { tracks: [], albums: [], artists: [] };
    const [tracks, albums, artists] = await Promise.all([
      fastify.prisma.musicTrack.findMany({
        where: {
          ...ownedTrackWhere(userId),
          OR: [
            { title: { contains: q } },
            { primaryArtist: { name: { contains: q } } },
            { album: { title: { contains: q } } },
          ],
        },
        include: musicTrackInclude(userId),
        take: 8,
      }),
      fastify.prisma.musicAlbum.findMany({
        where: {
          userId,
          tracks: { some: ownedTrackWhere(userId) },
          OR: [{ title: { contains: q } }, { artist: { name: { contains: q } } }],
        },
        include: {
          artwork: { select: { id: true } },
          artist: true,
          _count: { select: { tracks: true } },
        },
        take: 6,
      }),
      fastify.prisma.musicArtist.findMany({
        where: {
          userId,
          name: { contains: q },
          trackCredits: { some: { track: ownedTrackWhere(userId) } },
        },
        include: {
          _count: { select: { albums: true, trackCredits: true } },
          albums: { where: { artworkId: { not: null } }, select: { artworkId: true }, take: 1 },
        },
        take: 6,
      }),
    ]);
    return {
      tracks: tracks.map(formatMusicTrack),
      albums: albums.map(albumDto),
      artists: artists.map((artist) => ({
        id: artist.id,
        name: artist.name,
        albumCount: artist._count.albums,
        trackCount: artist._count.trackCredits,
        artworkUrl: artist.albums[0]?.artworkId
          ? `/api/music/artwork/${artist.albums[0].artworkId}`
          : null,
      })),
    };
  });

  fastify.get('/favorites', async (request) => {
    const userId = request.user!.id;
    const favorites = await fastify.prisma.musicFavorite.findMany({
      where: { userId, track: ownedTrackWhere(userId) },
      include: { track: { include: musicTrackInclude(userId) } },
      orderBy: { createdAt: 'desc' },
    });
    return { tracks: favorites.map((favorite) => formatMusicTrack(favorite.track)) };
  });
  fastify.post<{ Params: { trackId: string } }>('/favorites/:trackId', async (request, reply) => {
    const userId = request.user!.id;
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.trackId, ...ownedTrackWhere(userId) },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    await fastify.prisma.musicFavorite.upsert({
      where: { userId_trackId: { userId, trackId: track.id } },
      create: { userId, trackId: track.id },
      update: {},
    });
    return reply.status(201).send({ favorite: true });
  });
  fastify.delete<{ Params: { trackId: string } }>('/favorites/:trackId', async (request) => {
    await fastify.prisma.musicFavorite.deleteMany({
      where: { userId: request.user!.id, trackId: request.params.trackId },
    });
    return { favorite: false };
  });

  fastify.get('/history', async (request) => {
    const userId = request.user!.id;
    const history = await fastify.prisma.musicHistory.findMany({
      where: { userId, track: ownedTrackWhere(userId) },
      include: { track: { include: musicTrackInclude(userId) } },
      orderBy: { playedAt: 'desc' },
      take: 100,
    });
    return {
      history: history.map((entry) => ({
        id: entry.id,
        playedAt: entry.playedAt.toISOString(),
        listenedSeconds: entry.listenedSeconds,
        track: formatMusicTrack(entry.track),
      })),
    };
  });
  fastify.post('/history', async (request, reply) => {
    const parsed = createMusicHistorySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz dinleme kaydı.',
          requestId: request.id,
        },
      });
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: parsed.data.trackId, ...ownedTrackWhere(request.user!.id) },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    const threshold = Math.min(30, track.duration || 30);
    if (parsed.data.listenedSeconds < threshold)
      return reply.status(400).send({
        error: {
          code: 'LISTEN_THRESHOLD_NOT_MET',
          message: 'Parça dinleme geçmişine eklenmek için yeterince oynatılmadı.',
          requestId: request.id,
        },
      });
    const history = await fastify.prisma.musicHistory.create({
      data: {
        userId: request.user!.id,
        trackId: track.id,
        listenedSeconds: parsed.data.listenedSeconds,
      },
    });
    return reply.status(201).send({ history });
  });

  fastify.get('/playlists', async (request) => {
    const playlists = await fastify.prisma.musicPlaylist.findMany({
      where: { userId: request.user!.id },
      include: { items: { include: { track: { select: { duration: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        itemCount: playlist.items.length,
        duration: playlist.items.reduce((sum, item) => sum + (item.track.duration || 0), 0),
        updatedAt: playlist.updatedAt.toISOString(),
      })),
    };
  });
  fastify.post('/playlists', async (request, reply) => {
    const parsed = createMusicPlaylistSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz çalma listesi.',
          requestId: request.id,
        },
      });
    return reply.status(201).send({
      playlist: await fastify.prisma.musicPlaylist.create({
        data: { userId: request.user!.id, ...parsed.data },
      }),
    });
  });
  fastify.get<{ Params: { id: string } }>('/playlists/:id', async (request, reply) => {
    const userId = request.user!.id;
    const playlist = await fastify.prisma.musicPlaylist.findFirst({
      where: { id: request.params.id, userId },
      include: {
        items: {
          include: { track: { include: musicTrackInclude(userId) } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!playlist)
      return reply.status(404).send({
        error: {
          code: 'PLAYLIST_NOT_FOUND',
          message: 'Çalma listesi bulunamadı.',
          requestId: request.id,
        },
      });
    return {
      playlist: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        itemCount: playlist.items.length,
        duration: playlist.items.reduce((sum, item) => sum + (item.track.duration || 0), 0),
        updatedAt: playlist.updatedAt.toISOString(),
        items: playlist.items.map((item) => ({
          id: item.id,
          position: item.position,
          track: formatMusicTrack(item.track),
        })),
      },
    };
  });
  fastify.patch<{ Params: { id: string } }>('/playlists/:id', async (request, reply) => {
    const parsed = updateMusicPlaylistSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz çalma listesi.',
          requestId: request.id,
        },
      });
    const result = await fastify.prisma.musicPlaylist.updateMany({
      where: { id: request.params.id, userId: request.user!.id },
      data: parsed.data,
    });
    if (!result.count)
      return reply.status(404).send({
        error: {
          code: 'PLAYLIST_NOT_FOUND',
          message: 'Çalma listesi bulunamadı.',
          requestId: request.id,
        },
      });
    return { updated: true };
  });
  fastify.delete<{ Params: { id: string } }>('/playlists/:id', async (request, reply) => {
    const result = await fastify.prisma.musicPlaylist.deleteMany({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!result.count)
      return reply.status(404).send({
        error: {
          code: 'PLAYLIST_NOT_FOUND',
          message: 'Çalma listesi bulunamadı.',
          requestId: request.id,
        },
      });
    return reply.status(204).send();
  });
  fastify.post<{ Params: { id: string } }>('/playlists/:id/items', async (request, reply) => {
    const parsed = addMusicPlaylistItemSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Geçersiz parça.', requestId: request.id },
      });
    const userId = request.user!.id;
    const [playlist, track] = await Promise.all([
      fastify.prisma.musicPlaylist.findFirst({ where: { id: request.params.id, userId } }),
      fastify.prisma.musicTrack.findFirst({
        where: { id: parsed.data.trackId, ...ownedTrackWhere(userId) },
      }),
    ]);
    if (!playlist || !track)
      return reply.status(404).send({
        error: {
          code: 'MUSIC_RESOURCE_NOT_FOUND',
          message: 'Çalma listesi veya parça bulunamadı.',
          requestId: request.id,
        },
      });
    const aggregate = await fastify.prisma.musicPlaylistItem.aggregate({
      where: { playlistId: playlist.id },
      _max: { position: true },
    });
    const item = await fastify.prisma.musicPlaylistItem.create({
      data: {
        playlistId: playlist.id,
        trackId: track.id,
        position: (aggregate._max.position ?? -1) + 1,
      },
    });
    return reply.status(201).send({ item });
  });
  fastify.delete<{ Params: { id: string; itemId: string } }>(
    '/playlists/:id/items/:itemId',
    async (request, reply) => {
      const playlist = await fastify.prisma.musicPlaylist.findFirst({
        where: { id: request.params.id, userId: request.user!.id },
      });
      if (!playlist)
        return reply.status(404).send({
          error: {
            code: 'PLAYLIST_NOT_FOUND',
            message: 'Çalma listesi bulunamadı.',
            requestId: request.id,
          },
        });
      await fastify.prisma.musicPlaylistItem.deleteMany({
        where: { id: request.params.itemId, playlistId: playlist.id },
      });
      const remaining = await fastify.prisma.musicPlaylistItem.findMany({
        where: { playlistId: playlist.id },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await fastify.prisma.$transaction(async (tx) => {
        for (const [position, item] of remaining.entries()) {
          await tx.musicPlaylistItem.update({
            where: { id: item.id },
            data: { position: position + 100000 },
          });
        }
        for (const [position, item] of remaining.entries()) {
          await tx.musicPlaylistItem.update({ where: { id: item.id }, data: { position } });
        }
      });
      return reply.status(204).send();
    },
  );
  fastify.put<{ Params: { id: string } }>('/playlists/:id/reorder', async (request, reply) => {
    const parsed = reorderMusicPlaylistSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Geçersiz sıralama.', requestId: request.id },
      });
    const playlist = await fastify.prisma.musicPlaylist.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
      include: { items: { select: { id: true } } },
    });
    if (
      !playlist ||
      playlist.items.length !== parsed.data.itemIds.length ||
      playlist.items.some((item) => !parsed.data.itemIds.includes(item.id))
    )
      return reply.status(400).send({
        error: {
          code: 'INVALID_PLAYLIST_ORDER',
          message: 'Sıralama tüm liste öğelerini içermelidir.',
          requestId: request.id,
        },
      });
    await fastify.prisma.$transaction(async (tx) => {
      for (const [position, id] of parsed.data.itemIds.entries()) {
        await tx.musicPlaylistItem.update({
          where: { id },
          data: { position: position + 100000 },
        });
      }
      for (const [position, id] of parsed.data.itemIds.entries()) {
        await tx.musicPlaylistItem.update({ where: { id }, data: { position } });
      }
    });
    return { reordered: true };
  });

  fastify.get('/playback-state', async (request) => {
    const userId = request.user!.id;
    const state = await fastify.prisma.musicPlaybackState.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: {
        queue: {
          include: { track: { include: musicTrackInclude(userId) } },
          orderBy: { playOrder: 'asc' },
        },
      },
    });
    return {
      state: {
        revision: state.revision,
        currentTrackId: state.currentTrackId,
        currentQueueItemId: state.currentQueueItemId,
        positionSeconds: state.positionSeconds,
        shuffleEnabled: state.shuffleEnabled,
        repeatMode: state.repeatMode,
        queue: state.queue.map((item) => ({
          id: item.id,
          trackId: item.trackId,
          sourceOrder: item.sourceOrder,
          playOrder: item.playOrder,
          track: formatMusicTrack(item.track),
        })),
      },
    };
  });
  fastify.put('/playback-state', async (request, reply) => {
    const parsed = updateMusicPlaybackStateSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz oynatma durumu.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const state = await fastify.prisma.musicPlaybackState.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    if (state.revision !== parsed.data.revision)
      return reply.status(409).send({
        error: {
          code: 'PLAYBACK_REVISION_CONFLICT',
          message: 'Oynatma durumu başka bir cihazda değişti.',
          requestId: request.id,
        },
      });
    const trackIds = [
      ...new Set(
        parsed.data.queue.map((item) => item.trackId).concat(parsed.data.currentTrackId || []),
      ),
    ];
    const ownedCount = await fastify.prisma.musicTrack.count({
      where: { id: { in: trackIds }, ...ownedTrackWhere(userId) },
    });
    if (ownedCount !== trackIds.length)
      return reply.status(404).send({
        error: {
          code: 'TRACK_NOT_FOUND',
          message: 'Kuyruktaki parçalardan biri bulunamadı.',
          requestId: request.id,
        },
      });
    const queue = parsed.data.queue.map((item) => ({ ...item, id: item.id || randomUUID() }));
    if (
      new Set(queue.map((item) => item.sourceOrder)).size !== queue.length ||
      new Set(queue.map((item) => item.playOrder)).size !== queue.length
    )
      return reply.status(400).send({
        error: {
          code: 'INVALID_QUEUE_ORDER',
          message: 'Kuyruk sırası benzersiz olmalıdır.',
          requestId: request.id,
        },
      });
    const currentQueueItemId =
      parsed.data.currentQueueItemId &&
      queue.some((item) => item.id === parsed.data.currentQueueItemId)
        ? parsed.data.currentQueueItemId
        : null;
    const revisionConflict = new Error('PLAYBACK_REVISION_CONFLICT');
    try {
      await fastify.prisma.$transaction(async (tx) => {
        const updated = await tx.musicPlaybackState.updateMany({
          where: { id: state.id, revision: parsed.data.revision },
          data: {
            currentTrackId: parsed.data.currentTrackId,
            currentQueueItemId,
            positionSeconds: parsed.data.positionSeconds,
            shuffleEnabled: parsed.data.shuffleEnabled,
            repeatMode: parsed.data.repeatMode,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw revisionConflict;
        await tx.musicQueueItem.deleteMany({ where: { playbackStateId: state.id } });
        if (queue.length)
          await tx.musicQueueItem.createMany({
            data: queue.map((item) => ({
              id: item.id,
              playbackStateId: state.id,
              trackId: item.trackId,
              sourceOrder: item.sourceOrder,
              playOrder: item.playOrder,
            })),
          });
      });
    } catch (error) {
      if (error === revisionConflict)
        return reply.status(409).send({
          error: {
            code: 'PLAYBACK_REVISION_CONFLICT',
            message: 'Oynatma durumu başka bir cihazda değişti.',
            requestId: request.id,
          },
        });
      throw error;
    }
    return {
      revision: state.revision + 1,
      queue: queue.map(({ id, trackId, sourceOrder, playOrder }) => ({
        id,
        trackId,
        sourceOrder,
        playOrder,
      })),
    };
  });

  fastify.get<{ Params: { id: string } }>('/artwork/:id', async (request, reply) => {
    const artwork = await fastify.prisma.musicArtwork.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!artwork)
      return reply.status(404).send({
        error: {
          code: 'ARTWORK_NOT_FOUND',
          message: 'Kapak görseli bulunamadı.',
          requestId: request.id,
        },
      });
    reply
      .header('Content-Type', artwork.mimeType)
      .header('Cache-Control', 'private, max-age=86400');
    return reply.send(Buffer.from(artwork.data));
  });

  fastify.get<{ Params: { id: string } }>('/tracks/:id/lyrics', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      include: { lyrics: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    if (!track.lyrics) return { lyrics: null };
    return { lyrics: formatLyrics(track.lyrics) };
  });

  fastify.post<{ Params: { id: string } }>('/tracks/:id/lyrics/lookup', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      include: { lyrics: true, primaryArtist: true, album: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    if (track.lyrics) return { lyrics: formatLyrics(track.lyrics), lookupStatus: 'existing' };
    if (!track.primaryArtist?.name || !track.album?.title || !track.duration)
      return { lyrics: null, lookupStatus: 'insufficient_metadata' };
    try {
      const result = await lyricsService.lookupOnlineLyrics({
        trackId: track.id,
        title: track.title,
        artist: track.primaryArtist.name,
        album: track.album.title,
        duration: track.duration,
      });
      if (result.status === 'not_found') return { lyrics: null, lookupStatus: 'not_found' };
      return { lyrics: formatLyrics(result.lyrics), lookupStatus: 'found' };
    } catch (error) {
      request.log.warn({ err: error, trackId: track.id }, 'Automatic lyrics lookup failed');
      return { lyrics: null, lookupStatus: 'unavailable' };
    }
  });

  fastify.put<{ Params: { id: string } }>('/tracks/:id/lyrics', async (request, reply) => {
    const parsed = updateMusicLyricsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz şarkı sözü dosyası.',
          requestId: request.id,
        },
      });
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      select: { id: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    await lyricsService.syncTrackLyrics({
      trackId: track.id,
      content: parsed.data.content,
      sourceName: parsed.data.sourceName,
      language: parsed.data.language,
      sourceType: 'manual',
    });
    return { updated: true };
  });

  fastify.delete<{ Params: { id: string } }>('/tracks/:id/lyrics', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      select: { id: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    await fastify.prisma.musicLyrics.deleteMany({ where: { trackId: track.id } });
    return reply.status(204).send();
  });

  const handleTrackStream = async (
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: { transcode?: string; start?: string };
    }>,
    reply: FastifyReply,
    head = false,
  ) => {
    const userId = request.user!.id;
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(userId) },
      include: { driveFile: { include: { library: true } } },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    const file = track.driveFile;
    const range = request.headers.range;
    const size = file.size === null ? null : Number(file.size);
    const resolution = resolveRangeRequest(range, size);
    if (
      resolution.kind === 'multi' ||
      resolution.kind === 'invalid' ||
      resolution.kind === 'unsatisfiable'
    ) {
      if (size !== null) reply.header('Content-Range', `bytes */${size}`);
      return reply.status(resolution.kind === 'multi' ? 400 : 416).send({
        error: {
          code: 'RANGE_NOT_SATISFIABLE',
          message: 'Geçersiz Range isteği.',
          requestId: request.id,
        },
      });
    }
    const transcode = request.query.transcode === '1' || request.query.transcode === 'true';
    const startSeconds = Number(request.query.start || 0);
    if (!Number.isFinite(startSeconds) || startSeconds < 0)
      return reply.status(400).send({
        error: {
          code: 'INVALID_TRANSCODE_START',
          message: 'Geçersiz başlangıç zamanı.',
          requestId: request.id,
        },
      });
    if (transcode) {
      reply.header('Content-Type', 'audio/mp4').header('Cache-Control', 'no-store');
      if (head) return reply.send();
      const source =
        file.storageType === 'local' && file.localFilePath
          ? { input: file.localFilePath, inputOptions: [] as string[] }
          : (() => {
              const remote = driveSourceInput(fastify, file, userId);
              return { input: remote.url, inputOptions: remote.inputOptions };
            })();
      const output = fastify.transcodeService.createTranscodedStream(source.input, {
        audioOnly: true,
        startSeconds,
        inputOptions: source.inputOptions,
      });
      request.raw.on('close', output.kill);
      return reply.send(output.stream);
    }
    if (file.storageType === 'local' && file.localFilePath) {
      if (!fs.existsSync(file.localFilePath))
        return reply.status(404).send({
          error: {
            code: 'LOCAL_FILE_NOT_FOUND',
            message: 'Ses dosyası diskte bulunamadı.',
            requestId: request.id,
          },
        });
      const stat = fs.statSync(file.localFilePath);
      const localResolution = resolveRangeRequest(range, stat.size);
      if (
        localResolution.kind === 'invalid' ||
        localResolution.kind === 'multi' ||
        localResolution.kind === 'unsatisfiable'
      )
        return reply.status(416).send();
      const start = localResolution.kind === 'range' ? localResolution.start : 0;
      const end =
        localResolution.kind === 'range' ? localResolution.end : Math.max(0, stat.size - 1);
      reply
        .status(localResolution.kind === 'range' ? 206 : 200)
        .header('Content-Type', file.mimeType || 'audio/mpeg')
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', Math.max(0, end - start + 1));
      if (localResolution.kind === 'range')
        reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      return head
        ? reply.send()
        : reply.send(fs.createReadStream(file.localFilePath, { start, end }));
    }
    let token: string;
    try {
      token = await fastify.googleOAuthService.getValidAccessToken(
        userId,
        file.library.googleConnectionId || undefined,
      );
    } catch {
      return reply.status(401).send({
        error: {
          code: 'GOOGLE_AUTH_REQUIRED',
          message: 'Google Drive bağlantısını yenileyin.',
          requestId: request.id,
        },
      });
    }
    if (head)
      return reply
        .header('Content-Type', file.mimeType || 'audio/mpeg')
        .header('Accept-Ranges', 'bytes')
        .send();
    const upstreamRange =
      resolution.kind === 'range' ? `bytes=${resolution.start}-${resolution.end}` : range;
    const upstream = await fastify.driveService.createMediaStream(
      token,
      file.googleDriveFileId!,
      upstreamRange,
    );
    for (const [key, value] of Object.entries(upstream.headers)) reply.header(key, value);
    reply
      .header('Content-Type', upstream.headers['content-type'] || file.mimeType || 'audio/mpeg')
      .header('Accept-Ranges', 'bytes')
      .status(upstream.status);
    return reply.send(upstream.stream);
  };
  fastify.get<{ Params: { id: string }; Querystring: { transcode?: string; start?: string } }>(
    '/tracks/:id/stream',
    (request, reply) => handleTrackStream(request, reply),
  );
  fastify.head<{ Params: { id: string }; Querystring: { transcode?: string; start?: string } }>(
    '/tracks/:id/stream',
    (request, reply) => handleTrackStream(request, reply, true),
  );
};

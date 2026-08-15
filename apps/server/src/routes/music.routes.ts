import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  addMusicPlaylistItemSchema,
  addMusicPlaylistItemsSchema,
  createMusicHistoryBatchSchema,
  createMusicHistorySchema,
  createMusicPlaylistSchema,
  createMusicPlaylistFromTracksSchema,
  musicListQuerySchema,
  musicDownloadManifestSchema,
  musicSyncQuerySchema,
  musicAlbumMaintenanceSchema,
  musicArtistMaintenanceSchema,
  musicArtistArtworkScanSchema,
  musicBulkMetadataSchema,
  musicReplayGainScanSchema,
  musicFingerprintScanSchema,
  musicMaintenanceGenerateSchema,
  musicDuplicateArchiveSchema,
  musicReplayQuerySchema,
  musicLyricsTranslationSchema,
  musicLyricsAlignSchema,
  musicLyricsRevisionSchema,
  musicPlaybackClientQuerySchema,
  reorderMusicPlaylistSchema,
  patchMusicPlaybackStateSchema,
  saveMusicMixSchema,
  updateMusicLyricsSchema,
  updateMusicTrackMetadataSchema,
  updateMusicPlaybackStateSchema,
  updateMusicPlaylistSchema,
} from '@cinedrive/shared';
import { resolveRangeRequest } from '../utils/http-range.js';
import {
  formatMusicArtist,
  formatMusicTrack,
  musicTrackInclude,
  parseGenres,
  resolveMusicContentType,
} from '../utils/music-format.js';
import { driveSourceInput } from './media/shared.js';
import {
  MusicLyricsService,
  alignPlainLyrics,
  parseLrc,
} from '../services/music-lyrics.service.js';
import { MusicBrainzService } from '../services/musicbrainz.service.js';
import { MusicDiscoveryService } from '../services/music-discovery.service.js';
import { MusicReplayGainService } from '../services/music-replaygain.service.js';
import { MusicReplayService } from '../services/music-replay.service.js';
import {
  MusicMaintenanceService,
  audioQuality,
  hasMeaningfulSuggestionChange,
} from '../services/music-maintenance.service.js';
import { MusicFingerprintService } from '../services/music-fingerprint.service.js';
import { MusicArtworkThumbnailService } from '../services/music-artwork-thumbnail.service.js';

// A native media player can probe many queued assets at once. Keep one client
// from turning those probes into hundreds of simultaneous Google Drive streams
// that exhaust the server's sockets and collapse unrelated network traffic.
const MAX_ACTIVE_DIRECT_MUSIC_TRANSFERS_PER_CLIENT = 2;
const MAX_ACTIVE_DIRECT_MUSIC_TRANSFERS_PER_USER = 6;
const MAX_ACTIVE_DIRECT_MUSIC_TRANSFERS_GLOBAL = 24;
const artworkThumbnails = new MusicArtworkThumbnailService();

const normalizeMusicName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const ownedTrackWhere = (userId: string): Prisma.MusicTrackWhereInput => ({
  library: { OR: [{ userId }, { memberships: { some: { userId } } }] },
  driveFile: { status: 'active' },
});

const ownerTrackWhere = (userId: string): Prisma.MusicTrackWhereInput => ({
  library: { userId },
  driveFile: { status: 'active' },
});

const manageableTrackWhere = (userId: string): Prisma.MusicTrackWhereInput => ({
  library: {
    OR: [
      { userId },
      { memberships: { some: { userId, role: { in: ['owner', 'editor'] } } } },
    ],
  },
  driveFile: { status: 'active' },
});

const formatLyrics = (lyrics: {
  trackId: string;
  content: string;
  translatedContent: string | null;
  romanizedContent: string | null;
  sourceName: string;
  language: string | null;
  translationLang: string | null;
  updatedAt: Date;
  translations?: Array<{
    id: string;
    language: string;
    content: string;
    provider: string;
    isMachine: boolean;
  }>;
  revisions?: Array<{
    id: string;
    sourceName: string;
    content: string;
    status: string;
    createdAt: Date;
  }>;
}) => {
  const parsed = parseLrc(lyrics.content);
  return {
    trackId: lyrics.trackId,
    sourceName: lyrics.sourceName,
    language: lyrics.language,
    isSynced: parsed.isSynced,
    offsetMs: parsed.offsetMs,
    lines: parsed.lines,
    content: lyrics.content,
    translatedContent: lyrics.translatedContent,
    romanizedContent: lyrics.romanizedContent,
    translatedLines: lyrics.translatedContent ? parseLrc(lyrics.translatedContent).lines : [],
    romanizedLines: lyrics.romanizedContent ? parseLrc(lyrics.romanizedContent).lines : [],
    translationLanguage: lyrics.translationLang,
    translations: (lyrics.translations || []).map((translation) => ({
      ...translation,
      lines: parseLrc(translation.content).lines,
    })),
    revisions: (lyrics.revisions || []).map((revision) => ({
      ...revision,
      createdAt: revision.createdAt.toISOString(),
    })),
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
  const activeDirectTransfers = new Map<string, Set<AbortController>>();
  const activeDirectTransfersByUser = new Map<string, Set<AbortController>>();
  const allActiveDirectTransfers = new Set<AbortController>();

  fastify.addHook('onSend', async (request, reply, payload) => {
    const contentType = String(reply.getHeader('content-type') || '');
    const serializedPayload =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : null;
    if (
      request.method === 'GET' &&
      request.url.includes('/tracks/') &&
      request.url.includes('/stream') &&
      reply.statusCode >= 400
    ) {
      let code = `HTTP_${reply.statusCode}`;
      if (serializedPayload && contentType.includes('application/json')) {
        try {
          const body: unknown = JSON.parse(serializedPayload);
          if (
            typeof body === 'object' &&
            body !== null &&
            'error' in body &&
            typeof body.error === 'object' &&
            body.error !== null &&
            'code' in body.error &&
            typeof body.error.code === 'string'
          )
            code = body.error.code;
        } catch {
          // The HTTP status remains a useful metric when an error body is not JSON.
        }
      }
      const query = request.query as { clientId?: unknown };
      request.log.warn(
        {
          event: 'music_stream_error',
          side: 'server',
          code,
          statusCode: reply.statusCode,
          userId: request.user?.id,
          clientId: typeof query.clientId === 'string' ? query.clientId : 'legacy',
        },
        'Music stream request failed',
      );
    }
    if (
      request.method !== 'GET' ||
      reply.statusCode !== 200 ||
      !contentType.includes('application/json') ||
      serializedPayload === null
    )
      return payload;
    const etag = `"${createHash('sha256').update(serializedPayload).digest('base64url')}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=0, must-revalidate');
    if (request.headers['if-none-match'] === etag) {
      reply.status(304);
      return '';
    }
    return payload;
  });

  const beginDirectTransfer = (
    userId: string,
    clientId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): { signal: AbortSignal; abort: () => void; release: () => void } | null => {
    const clientKey = `${userId}:${clientId}`;
    const active = activeDirectTransfers.get(clientKey) || new Set<AbortController>();
    const userActive = activeDirectTransfersByUser.get(userId) || new Set<AbortController>();
    if (
      active.size >=
        (clientId === 'legacy' ? 4 : MAX_ACTIVE_DIRECT_MUSIC_TRANSFERS_PER_CLIENT) ||
      userActive.size >= MAX_ACTIVE_DIRECT_MUSIC_TRANSFERS_PER_USER ||
      allActiveDirectTransfers.size >= MAX_ACTIVE_DIRECT_MUSIC_TRANSFERS_GLOBAL
    )
      return null;

    const controller = new AbortController();
    active.add(controller);
    userActive.add(controller);
    allActiveDirectTransfers.add(controller);
    activeDirectTransfers.set(clientKey, active);
    activeDirectTransfersByUser.set(userId, userActive);
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      request.raw.removeListener('aborted', abort);
      reply.raw.removeListener('close', onResponseClose);
      reply.raw.removeListener('finish', release);
      reply.raw.removeListener('error', abort);
      active.delete(controller);
      userActive.delete(controller);
      allActiveDirectTransfers.delete(controller);
      if (active.size === 0) activeDirectTransfers.delete(clientKey);
      if (userActive.size === 0) activeDirectTransfersByUser.delete(userId);
    };
    const abort = () => {
      controller.abort();
      release();
    };
    const onResponseClose = () => {
      if (!reply.raw.writableEnded) abort();
      else release();
    };

    request.raw.once('aborted', abort);
    reply.raw.once('close', onResponseClose);
    reply.raw.once('finish', release);
    reply.raw.once('error', abort);
    return { signal: controller.signal, abort, release };
  };

  const transferCapacityError = (request: FastifyRequest, reply: FastifyReply) =>
    reply
      .header('Retry-After', '2')
      .status(429)
      .send({
        error: {
          code: 'MUSIC_TRANSFER_CAPACITY_REACHED',
          message: 'Aynı anda çok fazla müzik aktarımı açık. Kısa süre sonra tekrar deneyin.',
          requestId: request.id,
        },
      });

  const lyricsService = new MusicLyricsService(fastify.prisma);
  const musicbrainz = new MusicBrainzService();
  const discoveryService = new MusicDiscoveryService(fastify.prisma);
  const replayGainService = new MusicReplayGainService(fastify.prisma);
  const replayService = new MusicReplayService(fastify.prisma);
  const maintenanceService = new MusicMaintenanceService(fastify.prisma);
  const fingerprintService = new MusicFingerprintService(fastify.prisma);
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
        where: { tracks: { some: trackWhere } },
        include: {
          artwork: { select: { id: true } },
          artist: true,
          _count: { select: { tracks: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      fastify.prisma.musicArtist.findMany({
        where: { trackCredits: { some: { track: trackWhere } } },
        include: {
          _count: { select: { albums: true, trackCredits: true } },
          artwork: { select: { id: true } },
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
      artists: artists.map(formatMusicArtist),
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

  fastify.get('/sync', async (request, reply) => {
    const parsed = musicSyncQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'INVALID_SYNC_CURSOR',
          message: 'Geçersiz müzik senkronizasyon imleci.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const cursor = parsed.data.cursor ? new Date(parsed.data.cursor) : null;
    const nextCursor = new Date();
    const trackWhere = ownedTrackWhere(userId);
    const changedTrackWhere: Prisma.MusicTrackWhereInput = {
      ...trackWhere,
      ...(cursor ? { updatedAt: { gt: cursor, lte: nextCursor } } : {}),
    };
    const [tracks, trackIds, albums, artists, playlists, favoriteTrackIds, history] =
      await Promise.all([
        fastify.prisma.musicTrack.findMany({
          where: changedTrackWhere,
          include: musicTrackInclude(userId),
          orderBy: { updatedAt: 'asc' },
        }),
        fastify.prisma.musicTrack.findMany({
          where: trackWhere,
          select: { id: true },
        }),
        fastify.prisma.musicAlbum.findMany({
          where: { tracks: { some: trackWhere } },
          include: {
            artwork: { select: { id: true } },
            artist: true,
            _count: { select: { tracks: { where: trackWhere } } },
          },
          orderBy: { title: 'asc' },
        }),
        fastify.prisma.musicArtist.findMany({
          where: { trackCredits: { some: { track: trackWhere } } },
          include: {
            _count: { select: { albums: true, trackCredits: true } },
            artwork: { select: { id: true } },
          },
          orderBy: { name: 'asc' },
        }),
        fastify.prisma.musicPlaylist.findMany({
          where: { userId },
          include: { items: { include: { track: { select: { duration: true } } } } },
          orderBy: { updatedAt: 'desc' },
        }),
        fastify.prisma.musicFavorite.findMany({
          where: { userId, track: trackWhere },
          select: { trackId: true },
          orderBy: { createdAt: 'desc' },
        }),
        fastify.prisma.musicHistory.findMany({
          where: { userId, track: trackWhere },
          include: { track: { include: musicTrackInclude(userId) } },
          orderBy: { playedAt: 'desc' },
          take: 100,
        }),
      ]);
    return {
      cursor: nextCursor.toISOString(),
      full: cursor === null,
      tracks: tracks.map(formatMusicTrack),
      trackIds: trackIds.map((track) => track.id),
      albums: albums.map(albumDto),
      artists: artists.map(formatMusicArtist),
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        itemCount: playlist.items.length,
        duration: playlist.items.reduce((sum, item) => sum + (item.track.duration || 0), 0),
        updatedAt: playlist.updatedAt.toISOString(),
      })),
      favoriteTrackIds: favoriteTrackIds.map((favorite) => favorite.trackId),
      history: history.map((entry) => ({
        id: entry.id,
        playedAt: entry.playedAt.toISOString(),
        listenedSeconds: entry.listenedSeconds,
        track: formatMusicTrack(entry.track),
      })),
    };
  });

  fastify.get('/discovery', async (request) => discoveryService.getDiscovery(request.user!.id));

  fastify.get<{ Params: { trackId: string } }>('/radio/track/:trackId', async (request, reply) => {
    const mix = await discoveryService.getTrackRadio(request.user!.id, request.params.trackId);
    if (!mix)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    return { mix };
  });

  fastify.get('/replay', async (request, reply) => {
    const parsed = musicReplayQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz Replay dönemi.',
          requestId: request.id,
        },
      });
    return replayService.get(request.user!.id, parsed.data.period, parsed.data.year);
  });

  fastify.get<{ Params: { artistId: string } }>('/radio/:artistId', async (request, reply) => {
    const artist = await fastify.prisma.musicArtist.findFirst({
      where: {
        id: request.params.artistId,
        trackCredits: { some: { track: ownedTrackWhere(request.user!.id) } },
      },
      select: { id: true },
    });
    if (!artist)
      return reply.status(404).send({
        error: { code: 'ARTIST_NOT_FOUND', message: 'Sanatçı bulunamadı.', requestId: request.id },
      });
    return { mix: await discoveryService.getArtistRadio(request.user!.id, artist.id) };
  });

  fastify.get('/maintenance', async (request) => {
    const userId = request.user!.id;
    const rawTracks = await fastify.prisma.musicTrack.findMany({
      where: ownedTrackWhere(userId),
      include: musicTrackInclude(userId),
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    });
    const tracks = rawTracks.map(formatMusicTrack);
    const maintenanceArtists = await fastify.prisma.musicArtist.findMany({
      where: {
        userId,
        OR: [
          { trackCredits: { some: { track: ownedTrackWhere(userId) } } },
          { albums: { some: { tracks: { some: ownedTrackWhere(userId) } } } },
        ],
      },
      include: {
        artwork: { select: { id: true } },
        _count: { select: { albums: true, trackCredits: true } },
      },
      orderBy: { name: 'asc' },
    });
    const missingArtwork = tracks.filter((track) => !track.artworkUrl);
    const missingMetadata = tracks
      .map((track) => {
        const issues: string[] = [];
        if (!track.primaryArtist || /^bilinmeyen|^unknown/i.test(track.primaryArtist.name))
          issues.push('artist');
        if (!track.album || /^bilinmeyen|^unknown/i.test(track.album.title)) issues.push('album');
        if (!track.year) issues.push('year');
        if (!track.genres.length) issues.push('genres');
        if (!track.musicbrainzRecordingId) issues.push('musicbrainz');
        const confidence = track.metadataLocked
          ? 100
          : Math.max(10, 100 - issues.length * 16 - (track.musicbrainzRecordingId ? 0 : 8));
        return { ...track, issues, confidence };
      })
      .filter((track) => track.issues.length > 0);
    const duplicateMap = new Map<string, typeof tracks>();
    tracks.forEach((track) => {
      const durationBucket = Math.round((track.duration || 0) / 2) * 2;
      const key = `${normalizeMusicName(track.title)}|${normalizeMusicName(track.primaryArtist?.name || '')}|${durationBucket}`;
      const group = duplicateMap.get(key) || [];
      group.push(track);
      duplicateMap.set(key, group);
    });
    const duplicates = [...duplicateMap.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => {
        const quality = group.map(audioQuality).sort((a, b) => b.score - a.score);
        return { key, tracks: group, quality, recommendedTrackId: quality[0]?.trackId };
      });
    const replayGainMissing = tracks.filter(
      (track) => track.audio?.replayGainTrackDb == null && track.audio?.replayGainAlbumDb == null,
    );
    const [rawSuggestions, actions, storedFingerprints, fingerprintCapability] = await Promise.all([
      fastify.prisma.musicMaintenanceSuggestion.findMany({
        where: { userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      fastify.prisma.musicMaintenanceAction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      fastify.prisma.musicFingerprint.findMany({ where: { track: ownedTrackWhere(userId) } }),
      fingerprintService.capability(userId),
    ]);
    const seenSuggestions = new Set<string>();
    const suggestions = rawSuggestions.filter((suggestion) => {
      const key = `${suggestion.targetType}:${suggestion.targetId}:${suggestion.kind}`;
      if (seenSuggestions.has(key)) return false;
      seenSuggestions.add(key);
      return hasMeaningfulSuggestionChange(
        suggestion.kind,
        JSON.parse(suggestion.currentData) as Record<string, unknown>,
        JSON.parse(suggestion.proposedData) as Record<string, unknown>,
      );
    });
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const acousticMap = new Map<string, typeof tracks>();
    storedFingerprints.forEach((fingerprint) => {
      if (!fingerprint.fingerprintHash) return;
      const track = trackById.get(fingerprint.trackId);
      if (!track) return;
      const key = `${fingerprint.fingerprintHash}|${Math.round(fingerprint.duration || 0)}`;
      const group = acousticMap.get(key) || [];
      group.push(track);
      acousticMap.set(key, group);
    });
    const acousticDuplicates = [...acousticMap.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => {
        const quality = group.map(audioQuality).sort((a, b) => b.score - a.score);
        return { key, tracks: group, quality, recommendedTrackId: quality[0]?.trackId };
      });
    const fingerprintedIds = new Set(
      storedFingerprints.filter((item) => item.status === 'analyzed').map((item) => item.trackId),
    );
    const fingerprintCandidates = tracks.filter((track) => !fingerprintedIds.has(track.id));
    const formattedArtists = maintenanceArtists.map((artist) => ({
      ...formatMusicArtist(artist),
      artworkSource: artist.artworkSource,
      artworkAttribution: artist.artworkAttribution,
      artworkLicense: artist.artworkLicense,
      artworkLookupStatus: artist.artworkLookupStatus,
      artworkLookupAt: artist.artworkLookupAt?.toISOString() || null,
    }));
    const artistById = new Map(formattedArtists.map((artist) => [artist.id, artist]));
    const albumById = new Map(
      tracks
        .filter((track) => track.album)
        .map((track) => [track.album!.id, track.album!] as const),
    );
    const suggestionTarget = (targetType: string, targetId: string) => {
      if (targetType === 'track') {
        const track = trackById.get(targetId);
        if (!track) return undefined;
        return {
          title: track.title,
          subtitle: [track.primaryArtist?.name, track.album?.title].filter(Boolean).join(' · '),
          artworkUrl: track.artworkUrl || null,
        };
      }
      if (targetType === 'album') {
        const album = albumById.get(targetId);
        if (!album) return undefined;
        return {
          title: album.title,
          subtitle: album.artist?.name || null,
          artworkUrl: album.artworkUrl || null,
        };
      }
      if (targetType === 'artist') {
        const artist = artistById.get(targetId);
        if (!artist) return undefined;
        return { title: artist.name, subtitle: null, artworkUrl: artist.artworkUrl || null };
      }
      return undefined;
    };
    return {
      artists: formattedArtists,
      missingArtwork: missingArtwork.slice(0, 100),
      missingMetadata: missingMetadata.slice(0, 100),
      duplicates: duplicates.slice(0, 100),
      acousticDuplicates: acousticDuplicates.slice(0, 100),
      replayGainMissing: replayGainMissing.slice(0, 100),
      fingerprintCandidates: fingerprintCandidates.slice(0, 100),
      fingerprints: {
        ...fingerprintCapability,
        total: storedFingerprints.length,
        analyzed: storedFingerprints.filter((item) => item.status === 'analyzed').length,
        identified: storedFingerprints.filter((item) => Boolean(item.acoustidId)).length,
        failed: storedFingerprints.filter((item) => item.status === 'failed').length,
      },
      suggestions: suggestions.map((item) => ({
        ...item,
        currentData: JSON.parse(item.currentData),
        proposedData: JSON.parse(item.proposedData),
        target: suggestionTarget(item.targetType, item.targetId),
        createdAt: item.createdAt.toISOString(),
        resolvedAt: item.resolvedAt?.toISOString() || null,
      })),
      actions: actions.map((item) => ({
        id: item.id,
        actionType: item.actionType,
        targetType: item.targetType,
        targetId: item.targetId,
        createdAt: item.createdAt.toISOString(),
        revertedAt: item.revertedAt?.toISOString() || null,
      })),
      totals: {
        missingArtistArtwork: maintenanceArtists.filter((artist) => !artist.artworkId).length,
        missingArtwork: missingArtwork.length,
        missingMetadata: missingMetadata.length,
        duplicates: duplicates.length,
        acousticDuplicates: acousticDuplicates.length,
        replayGainMissing: replayGainMissing.length,
      },
    };
  });

  fastify.post('/maintenance/suggestions/generate', async (request, reply) => {
    const parsed = musicMaintenanceGenerateSchema.safeParse(request.body || {});
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz bakım isteği.',
          requestId: request.id,
        },
      });
    return maintenanceService.generate(request.user!.id, parsed.data);
  });

  fastify.post('/maintenance/artists/artwork/scan', async (request, reply) => {
    const parsed = musicArtistArtworkScanSchema.safeParse(request.body || {});
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz sanatçı görseli tarama isteği.',
          requestId: request.id,
        },
      });
    return maintenanceService.scanArtistArtwork(request.user!.id, parsed.data);
  });

  fastify.post<{ Params: { id: string } }>(
    '/maintenance/suggestions/:id/accept',
    async (request, reply) => {
      const result = await maintenanceService.resolve(request.user!.id, request.params.id, true);
      if (!result)
        return reply.status(404).send({
          error: {
            code: 'SUGGESTION_NOT_FOUND',
            message: 'Öneri bulunamadı.',
            requestId: request.id,
          },
        });
      return result;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/maintenance/suggestions/:id/reject',
    async (request, reply) => {
      const result = await maintenanceService.resolve(request.user!.id, request.params.id, false);
      if (!result)
        return reply.status(404).send({
          error: {
            code: 'SUGGESTION_NOT_FOUND',
            message: 'Öneri bulunamadı.',
            requestId: request.id,
          },
        });
      return result;
    },
  );

  fastify.post('/maintenance/duplicates/archive', async (request, reply) => {
    const parsed = musicDuplicateArchiveSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz yinelenen parça işlemi.',
          requestId: request.id,
        },
      });
    const result = await maintenanceService.archiveDuplicate(request.user!.id, parsed.data);
    if (!result)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    return result;
  });

  fastify.post<{ Params: { id: string } }>(
    '/maintenance/actions/:id/undo',
    async (request, reply) => {
      const result = await maintenanceService.undo(request.user!.id, request.params.id);
      if (!result)
        return reply.status(404).send({
          error: {
            code: 'ACTION_NOT_FOUND',
            message: 'Geri alınabilir işlem bulunamadı.',
            requestId: request.id,
          },
        });
      return result;
    },
  );

  fastify.patch('/maintenance/tracks', async (request, reply) => {
    const parsed = musicBulkMetadataSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz toplu işlem.',
          requestId: request.id,
        },
      });
    const ownedIds = await fastify.prisma.musicTrack.findMany({
      where: { id: { in: parsed.data.trackIds }, ...ownerTrackWhere(request.user!.id) },
      select: { id: true, primaryArtist: { select: { name: true } } },
    });
    const upsertArtist = (name: string) =>
      fastify.prisma.musicArtist.upsert({
        where: {
          userId_normalizedName: {
            userId: request.user!.id,
            normalizedName: normalizeMusicName(name),
          },
        },
        create: {
          userId: request.user!.id,
          name,
          normalizedName: normalizeMusicName(name),
        },
        update: { name },
      });
    const data: Prisma.MusicTrackUncheckedUpdateManyInput = {};
    let targetArtistId: string | undefined;
    if (parsed.data.artist) {
      targetArtistId = (await upsertArtist(parsed.data.artist)).id;
      data.primaryArtistId = targetArtistId;
    }
    if (parsed.data.album) {
      const albumArtistName =
        parsed.data.albumArtist ||
        parsed.data.artist ||
        ownedIds[0]?.primaryArtist?.name ||
        'Bilinmeyen Sanatçı';
      const albumArtist = await upsertArtist(albumArtistName);
      const album = await fastify.prisma.musicAlbum.upsert({
        where: {
          userId_artistId_normalizedTitle: {
            userId: request.user!.id,
            artistId: albumArtist.id,
            normalizedTitle: normalizeMusicName(parsed.data.album),
          },
        },
        create: {
          userId: request.user!.id,
          artistId: albumArtist.id,
          title: parsed.data.album,
          normalizedTitle: normalizeMusicName(parsed.data.album),
          metadataStatus: 'manual',
        },
        update: { title: parsed.data.album, metadataStatus: 'manual' },
      });
      data.albumId = album.id;
    }
    if (parsed.data.genres !== undefined) data.genres = JSON.stringify(parsed.data.genres);
    if (parsed.data.year !== undefined) data.year = parsed.data.year;
    if (parsed.data.metadataLocked !== undefined) data.metadataLocked = parsed.data.metadataLocked;
    const result = await fastify.prisma.musicTrack.updateMany({
      where: { id: { in: ownedIds.map((track) => track.id) } },
      data,
    });
    if (targetArtistId) {
      await fastify.prisma.$transaction([
        fastify.prisma.musicTrackArtist.deleteMany({
          where: { trackId: { in: ownedIds.map((track) => track.id) } },
        }),
        fastify.prisma.musicTrackArtist.createMany({
          data: ownedIds.map((track) => ({
            trackId: track.id,
            artistId: targetArtistId!,
            position: 0,
          })),
        }),
      ]);
    }
    return { updated: result.count };
  });

  fastify.patch<{ Params: { id: string } }>('/maintenance/albums/:id', async (request, reply) => {
    const parsed = musicAlbumMaintenanceSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz albüm bilgisi.',
          requestId: request.id,
        },
      });
    const album = await fastify.prisma.musicAlbum.findFirst({
      where: { id: request.params.id, userId: request.user!.id },
    });
    if (!album)
      return reply.status(404).send({
        error: { code: 'ALBUM_NOT_FOUND', message: 'Albüm bulunamadı.', requestId: request.id },
      });
    let artistId: string | undefined;
    if (parsed.data.artist) {
      const artist = await fastify.prisma.musicArtist.upsert({
        where: {
          userId_normalizedName: {
            userId: request.user!.id,
            normalizedName: normalizeMusicName(parsed.data.artist),
          },
        },
        create: {
          userId: request.user!.id,
          name: parsed.data.artist,
          normalizedName: normalizeMusicName(parsed.data.artist),
        },
        update: { name: parsed.data.artist },
      });
      artistId = artist.id;
    }
    await fastify.prisma.musicAlbum.update({
      where: { id: album.id },
      data: {
        title: parsed.data.title,
        normalizedTitle: parsed.data.title ? normalizeMusicName(parsed.data.title) : undefined,
        artistId,
        year: parsed.data.year,
        genres: parsed.data.genres ? JSON.stringify(parsed.data.genres) : undefined,
        releaseType: parsed.data.releaseType,
        metadataStatus: 'manual',
      },
    });
    return { updated: true };
  });

  fastify.patch<{ Params: { id: string } }>(
    '/maintenance/artists/:id',
    { bodyLimit: 9 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = musicArtistMaintenanceSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz sanatçı bilgisi.',
            requestId: request.id,
          },
        });
      try {
        const artist = await maintenanceService.updateArtist(
          request.user!.id,
          request.params.id,
          parsed.data,
        );
        if (!artist)
          return reply.status(404).send({
            error: {
              code: 'ARTIST_NOT_FOUND',
              message: 'Sanatçı bulunamadı.',
              requestId: request.id,
            },
          });
        return { updated: true };
      } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_ARTIST_ARTWORK') {
          return reply.status(400).send({
            error: {
              code: 'INVALID_ARTIST_ARTWORK',
              message: 'Sanatçı görseli JPEG, PNG veya WebP olmalı ve 6 MB sınırını aşmamalı.',
              requestId: request.id,
            },
          });
        }
        throw error;
      }
    },
  );

  fastify.post('/maintenance/replaygain', async (request, reply) => {
    const parsed = musicReplayGainScanSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz ReplayGain işlemi.',
          requestId: request.id,
        },
      });
    return replayGainService.scan(request.user!.id, parsed.data.trackIds);
  });

  fastify.post('/maintenance/fingerprints', async (request, reply) => {
    const parsed = musicFingerprintScanSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz akustik parmak izi işlemi.',
          requestId: request.id,
        },
      });
    return fingerprintService.scan(request.user!.id, parsed.data, (driveFile) =>
      driveFile.googleDriveFileId
        ? driveSourceInput(fastify, driveFile, request.user!.id).url
        : null,
    );
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
      where: { id: request.params.id, ...manageableTrackWhere(userId) },
      include: { album: true, library: { select: { userId: true } } },
    });
    if (!existing)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    const input = parsed.data;
    const catalogOwnerId = existing.library.userId;
    await fastify.prisma.$transaction(async (transaction) => {
      const primaryArtist = await transaction.musicArtist.upsert({
        where: {
          userId_normalizedName: {
            userId: catalogOwnerId,
            normalizedName: normalizeMusicName(input.artist),
          },
        },
        create: {
          userId: catalogOwnerId,
          name: input.artist,
          normalizedName: normalizeMusicName(input.artist),
        },
        update: { name: input.artist },
      });
      const albumArtistName = input.albumArtist || input.artist;
      const albumArtist = await transaction.musicArtist.upsert({
        where: {
          userId_normalizedName: {
            userId: catalogOwnerId,
            normalizedName: normalizeMusicName(albumArtistName),
          },
        },
        create: {
          userId: catalogOwnerId,
          name: albumArtistName,
          normalizedName: normalizeMusicName(albumArtistName),
        },
        update: { name: albumArtistName },
      });
      const album = await transaction.musicAlbum.upsert({
        where: {
          userId_artistId_normalizedTitle: {
            userId: catalogOwnerId,
            artistId: albumArtist.id,
            normalizedTitle: normalizeMusicName(input.album),
          },
        },
        create: {
          userId: catalogOwnerId,
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
      where: { id: request.params.id, ...manageableTrackWhere(userId) },
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
      where: { id: request.params.id, tracks: { some: ownedTrackWhere(userId) } },
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
      where: { trackCredits: { some: { track: ownedTrackWhere(userId) } } },
      include: {
        _count: { select: { albums: true, trackCredits: true } },
        artwork: { select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });
    return {
      artists: artists.map(formatMusicArtist),
    };
  });

  fastify.get<{ Params: { id: string } }>('/artists/:id', async (request, reply) => {
    const userId = request.user!.id;
    const artist = await fastify.prisma.musicArtist.findFirst({
      where: {
        id: request.params.id,
        trackCredits: { some: { track: ownedTrackWhere(userId) } },
      },
      include: {
        artwork: { select: { id: true } },
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
            trackCredits: { some: { track: ownedTrackWhere(userId) } },
          },
          include: {
            _count: { select: { albums: true, trackCredits: true } },
            artwork: { select: { id: true } },
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
      .map(({ artist: candidate }) => formatMusicArtist(candidate));
    return {
      artist: {
        id: artist.id,
        name: artist.name,
        sortName: artist.sortName,
        musicbrainzId: artist.musicbrainzId,
        artworkUrl: artist.artwork?.id ? `/api/music/artwork/${artist.artwork.id}` : null,
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
          name: { contains: q },
          trackCredits: { some: { track: ownedTrackWhere(userId) } },
        },
        include: {
          _count: { select: { albums: true, trackCredits: true } },
          artwork: { select: { id: true } },
        },
        take: 6,
      }),
    ]);
    return {
      tracks: tracks.map(formatMusicTrack),
      albums: albums.map(albumDto),
      artists: artists.map(formatMusicArtist),
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
    // Browser media duration can be a fraction shorter than the duration stored
    // by the scanner. Accept a small metadata drift at the listen boundary.
    if (parsed.data.listenedSeconds + 0.5 < threshold)
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
  fastify.post('/history/batch', async (request, reply) => {
    const parsed = createMusicHistoryBatchSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz dinleme kayıtları.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const trackIds = [...new Set(parsed.data.events.map((event) => event.trackId))];
    const tracks = await fastify.prisma.musicTrack.findMany({
      where: { id: { in: trackIds }, ...ownedTrackWhere(userId) },
      select: { id: true, duration: true },
    });
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    const accepted = parsed.data.events.filter((event) => {
      const track = tracksById.get(event.trackId);
      return track && event.listenedSeconds + 0.5 >= Math.min(30, track.duration || 30);
    });
    await fastify.prisma.$transaction(
      accepted.map((event) =>
        fastify.prisma.musicHistory.upsert({
          where: { userId_eventId: { userId, eventId: event.eventId } },
          create: {
            userId,
            eventId: event.eventId,
            trackId: event.trackId,
            listenedSeconds: event.listenedSeconds,
            playedAt: event.playedAt ? new Date(event.playedAt) : undefined,
          },
          update: {},
        }),
      ),
    );
    const acceptedIds = new Set(accepted.map((event) => event.eventId));
    return reply.status(201).send({
      acceptedEventIds: [...acceptedIds],
      rejectedEventIds: parsed.data.events
        .filter((event) => !acceptedIds.has(event.eventId))
        .map((event) => event.eventId),
    });
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
  fastify.post('/playlists/from-mix', async (request, reply) => {
    const parsed = saveMusicMixSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz mix bilgileri.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const trackIds = [...new Set(parsed.data.trackIds)];
    const ownedTracks = await fastify.prisma.musicTrack.findMany({
      where: { id: { in: trackIds }, ...ownedTrackWhere(userId) },
      select: { id: true, duration: true },
    });
    if (ownedTracks.length !== trackIds.length)
      return reply.status(404).send({
        error: {
          code: 'MIX_TRACK_NOT_FOUND',
          message: 'Mix içindeki bazı parçalar kütüphanede bulunamadı.',
          requestId: request.id,
        },
      });
    const playlist = await fastify.prisma.musicPlaylist.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        items: {
          create: trackIds.map((trackId, position) => ({ trackId, position })),
        },
      },
      include: { items: { include: { track: { select: { duration: true } } } } },
    });
    return reply.status(201).send({
      playlist: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        itemCount: playlist.items.length,
        duration: playlist.items.reduce((sum, item) => sum + (item.track.duration || 0), 0),
        updatedAt: playlist.updatedAt.toISOString(),
      },
    });
  });
  fastify.post('/playlists/from-tracks', async (request, reply) => {
    const parsed = createMusicPlaylistFromTracksSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz çalma listesi bilgileri.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const uniqueTrackIds = [...new Set(parsed.data.trackIds)];
    const ownedTracks = await fastify.prisma.musicTrack.findMany({
      where: { id: { in: uniqueTrackIds }, ...ownedTrackWhere(userId) },
      select: { id: true, duration: true },
    });
    if (ownedTracks.length !== uniqueTrackIds.length)
      return reply.status(404).send({
        error: {
          code: 'PLAYLIST_TRACK_NOT_FOUND',
          message: 'Seçilen parçalardan bazıları kütüphanede bulunamadı.',
          requestId: request.id,
        },
      });
    const durationByTrackId = new Map(ownedTracks.map((track) => [track.id, track.duration || 0]));
    const playlist = await fastify.prisma.musicPlaylist.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description,
        items: {
          create: parsed.data.trackIds.map((trackId, position) => ({ trackId, position })),
        },
      },
    });
    return reply.status(201).send({
      playlist: {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        itemCount: parsed.data.trackIds.length,
        duration: parsed.data.trackIds.reduce(
          (sum, trackId) => sum + (durationByTrackId.get(trackId) || 0),
          0,
        ),
        updatedAt: playlist.updatedAt.toISOString(),
      },
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
    await fastify.prisma.musicPlaylist.update({
      where: { id: playlist.id },
      data: { updatedAt: new Date() },
    });
    return reply.status(201).send({ item });
  });
  fastify.post<{ Params: { id: string } }>('/playlists/:id/items/batch', async (request, reply) => {
    const parsed = addMusicPlaylistItemsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Geçersiz parçalar.', requestId: request.id },
      });
    const userId = request.user!.id;
    const uniqueTrackIds = [...new Set(parsed.data.trackIds)];
    const [playlist, ownedTrackCount] = await Promise.all([
      fastify.prisma.musicPlaylist.findFirst({
        where: { id: request.params.id, userId },
        select: { id: true },
      }),
      fastify.prisma.musicTrack.count({
        where: { id: { in: uniqueTrackIds }, ...ownedTrackWhere(userId) },
      }),
    ]);
    if (!playlist || ownedTrackCount !== uniqueTrackIds.length)
      return reply.status(404).send({
        error: {
          code: 'MUSIC_RESOURCE_NOT_FOUND',
          message: 'Çalma listesi veya seçilen parçalardan bazıları bulunamadı.',
          requestId: request.id,
        },
      });
    const aggregate = await fastify.prisma.musicPlaylistItem.aggregate({
      where: { playlistId: playlist.id },
      _max: { position: true },
    });
    const firstPosition = (aggregate._max.position ?? -1) + 1;
    await fastify.prisma.$transaction([
      fastify.prisma.musicPlaylistItem.createMany({
        data: parsed.data.trackIds.map((trackId, index) => ({
          playlistId: playlist.id,
          trackId,
          position: firstPosition + index,
        })),
      }),
      fastify.prisma.musicPlaylist.update({
        where: { id: playlist.id },
        data: { updatedAt: new Date() },
      }),
    ]);
    return reply.status(201).send({ added: parsed.data.trackIds.length });
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
        await tx.musicPlaylist.update({
          where: { id: playlist.id },
          data: { updatedAt: new Date() },
        });
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
      await tx.musicPlaylist.update({
        where: { id: playlist.id },
        data: { updatedAt: new Date() },
      });
    });
    return { reordered: true };
  });

  fastify.get<{ Querystring: { clientId?: string; clientName?: string; platform?: string } }>('/playback-state', async (request, reply) => {
    const client = musicPlaybackClientQuerySchema.safeParse(request.query);
    if (!client.success) return reply.status(400).send({ error: { code: 'INVALID_PLAYBACK_CLIENT', message: 'Geçersiz oynatıcı kimliği.', requestId: request.id } });
    const userId = request.user!.id;
    const state = await fastify.prisma.musicPlaybackState.upsert({
      where: { userId_clientId: { userId, clientId: client.data.clientId } },
      create: { userId, clientId: client.data.clientId, clientName: client.data.clientName, platform: client.data.platform },
      update: { clientName: client.data.clientName, platform: client.data.platform },
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
        clientId: state.clientId,
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
  fastify.put<{ Querystring: { clientId?: string; clientName?: string; platform?: string } }>('/playback-state', async (request, reply) => {
    const client = musicPlaybackClientQuerySchema.safeParse(request.query);
    if (!client.success) return reply.status(400).send({ error: { code: 'INVALID_PLAYBACK_CLIENT', message: 'Geçersiz oynatıcı kimliği.', requestId: request.id } });
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
      where: { userId_clientId: { userId, clientId: client.data.clientId } },
      create: { userId, clientId: client.data.clientId, clientName: client.data.clientName, platform: client.data.platform },
      update: { clientName: client.data.clientName, platform: client.data.platform },
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

  fastify.patch<{ Querystring: { clientId?: string; clientName?: string; platform?: string } }>('/playback-state', async (request, reply) => {
    const client = musicPlaybackClientQuerySchema.safeParse(request.query);
    if (!client.success) return reply.status(400).send({ error: { code: 'INVALID_PLAYBACK_CLIENT', message: 'Geçersiz oynatıcı kimliği.', requestId: request.id } });
    const parsed = patchMusicPlaybackStateSchema.safeParse(request.body);
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
      where: { userId_clientId: { userId, clientId: client.data.clientId } },
      create: { userId, clientId: client.data.clientId, clientName: client.data.clientName, platform: client.data.platform },
      update: { clientName: client.data.clientName, platform: client.data.platform },
      include: { queue: { select: { id: true } } },
    });
    if (state.revision !== parsed.data.revision)
      return reply.status(409).send({
        error: {
          code: 'PLAYBACK_REVISION_CONFLICT',
          message: 'Oynatma durumu başka bir cihazda değişti.',
          requestId: request.id,
        },
      });
    if (
      parsed.data.currentQueueItemId &&
      !state.queue.some((item) => item.id === parsed.data.currentQueueItemId)
    )
      return reply.status(400).send({
        error: {
          code: 'INVALID_CURRENT_QUEUE_ITEM',
          message: 'Geçerli kuyruk öğesi bulunamadı.',
          requestId: request.id,
        },
      });
    if (parsed.data.currentTrackId) {
      const owned = await fastify.prisma.musicTrack.count({
        where: { id: parsed.data.currentTrackId, ...ownedTrackWhere(userId) },
      });
      if (!owned)
        return reply.status(404).send({
          error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
        });
    }
    const updated = await fastify.prisma.musicPlaybackState.updateMany({
      where: { id: state.id, revision: parsed.data.revision },
      data: {
        currentTrackId: parsed.data.currentTrackId,
        currentQueueItemId: parsed.data.currentQueueItemId || null,
        positionSeconds: parsed.data.positionSeconds,
        shuffleEnabled: parsed.data.shuffleEnabled,
        repeatMode: parsed.data.repeatMode,
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      return reply.status(409).send({
        error: {
          code: 'PLAYBACK_REVISION_CONFLICT',
          message: 'Oynatma durumu başka bir cihazda değişti.',
          requestId: request.id,
        },
      });
    return { revision: state.revision + 1 };
  });

  fastify.get('/playback-clients', async (request) => ({
    clients: await fastify.prisma.musicPlaybackState.findMany({
      where: { userId: request.user!.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        clientId: true,
        clientName: true,
        platform: true,
        currentTrackId: true,
        positionSeconds: true,
        updatedAt: true,
      },
    }),
  }));

  fastify.delete<{ Params: { clientId: string } }>('/playback-clients/:clientId', async (request, reply) => {
    await fastify.prisma.musicPlaybackState.deleteMany({
      where: { userId: request.user!.id, clientId: request.params.clientId },
    });
    return reply.status(204).send();
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { thumbnail?: string; width?: string; height?: string; quality?: string };
  }>('/artwork/:id', async (request, reply) => {
    const artwork = await fastify.prisma.musicArtwork.findFirst({
      where: {
        id: request.params.id,
        OR: [
          { tracks: { some: ownedTrackWhere(request.user!.id) } },
          { albums: { some: { tracks: { some: ownedTrackWhere(request.user!.id) } } } },
          {
            artists: {
              some: { trackCredits: { some: { track: ownedTrackWhere(request.user!.id) } } },
            },
          },
        ],
      },
    });
    if (!artwork)
      return reply.status(404).send({
        error: {
          code: 'ARTWORK_NOT_FOUND',
          message: 'Kapak görseli bulunamadı.',
          requestId: request.id,
        },
      });
    const requestedWidth = Number(request.query.width || 0);
    const requestedHeight = Number(request.query.height || 0);
    const requestedQuality = Number(request.query.quality || 0);
    const shouldResize =
      request.query.thumbnail === '1' ||
      (Number.isFinite(requestedWidth) && requestedWidth > 0) ||
      (Number.isFinite(requestedHeight) && requestedHeight > 0);
    const width = Math.max(
      32,
      Math.min(2048, Math.round(requestedWidth > 0 ? requestedWidth : 256)),
    );
    const height = Math.max(
      32,
      Math.min(2048, Math.round(requestedHeight > 0 ? requestedHeight : width)),
    );
    const quality = Math.max(
      20,
      Math.min(100, Math.round(requestedQuality > 0 ? requestedQuality : 82)),
    );
    const variant = shouldResize ? `${width}x${height}q${quality}` : 'original';
    const etag = `"${artwork.checksum}-${variant}"`;
    if (request.headers['if-none-match'] === etag)
      return reply.header('ETag', etag).status(304).send();
    const source = Buffer.from(artwork.data);
    const thumbnail = shouldResize
      ? await artworkThumbnails.thumbnail(artwork.id, source, { width, height, quality })
      : null;
    reply
      .header('Content-Type', thumbnail ? 'image/jpeg' : artwork.mimeType)
      .header('ETag', etag)
      .header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(thumbnail ?? source);
  });

  fastify.get<{ Params: { id: string } }>('/tracks/:id/lyrics', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      include: {
        lyrics: {
          include: { translations: true, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        },
      },
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
      where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
      include: {
        lyrics: {
          include: { translations: true, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        },
        primaryArtist: true,
        album: true,
      },
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
      where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
      select: { id: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    await lyricsService.syncTrackLyrics({
      trackId: track.id,
      content: parsed.data.content,
      translatedContent: parsed.data.translatedContent,
      romanizedContent: parsed.data.romanizedContent,
      sourceName: parsed.data.sourceName,
      language: parsed.data.language,
      translationLanguage: parsed.data.translationLanguage,
      sourceType: 'manual',
    });
    const lyrics = await fastify.prisma.musicLyrics.findUniqueOrThrow({
      where: { trackId: track.id },
      include: { translations: true, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    return { updated: true, lyrics: formatLyrics(lyrics) };
  });

  fastify.post<{ Params: { id: string } }>(
    '/tracks/:id/lyrics/translations/auto',
    async (request, reply) => {
      const parsed = musicLyricsTranslationSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz çeviri dili.',
            requestId: request.id,
          },
        });
      const track = await fastify.prisma.musicTrack.findFirst({
        where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
        select: { id: true, lyrics: { select: { id: true } } },
      });
      if (!track?.lyrics)
        return reply.status(404).send({
          error: {
            code: 'LYRICS_NOT_FOUND',
            message: 'Şarkı sözü bulunamadı.',
            requestId: request.id,
          },
        });
      try {
        await lyricsService.translate(track.id, parsed.data.language);
        const lyrics = await fastify.prisma.musicLyrics.findUniqueOrThrow({
          where: { trackId: track.id },
          include: { translations: true, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        });
        return { lyrics: formatLyrics(lyrics) };
      } catch (error) {
        request.log.warn({ err: error }, 'Lyric translation failed');
        return reply.status(503).send({
          error: {
            code: 'TRANSLATION_UNAVAILABLE',
            message: 'Çeviri sağlayıcısına ulaşılamadı. LibreTranslate ayarlarını kontrol edin.',
            requestId: request.id,
          },
        });
      }
    },
  );

  fastify.put<{ Params: { id: string; language: string } }>(
    '/tracks/:id/lyrics/translations/:language',
    async (request, reply) => {
      const parsed = musicLyricsTranslationSchema.safeParse({
        ...(request.body as object),
        language: request.params.language,
      });
      if (!parsed.success || parsed.data.content === undefined)
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Geçersiz çeviri.', requestId: request.id },
        });
      const track = await fastify.prisma.musicTrack.findFirst({
        where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
        select: { lyrics: { select: { id: true } } },
      });
      if (!track?.lyrics)
        return reply.status(404).send({
          error: {
            code: 'LYRICS_NOT_FOUND',
            message: 'Şarkı sözü bulunamadı.',
            requestId: request.id,
          },
        });
      await fastify.prisma.musicLyricsTranslation.upsert({
        where: { lyricsId_language: { lyricsId: track.lyrics.id, language: parsed.data.language } },
        create: {
          lyricsId: track.lyrics.id,
          language: parsed.data.language,
          content: parsed.data.content,
          provider: 'manual',
        },
        update: { content: parsed.data.content, provider: 'manual', isMachine: false },
      });
      const lyrics = await fastify.prisma.musicLyrics.findUniqueOrThrow({
        where: { id: track.lyrics.id },
        include: { translations: true, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
      return { lyrics: formatLyrics(lyrics) };
    },
  );

  fastify.post<{ Params: { id: string } }>('/tracks/:id/lyrics/align', async (request, reply) => {
    const parsed = musicLyricsAlignSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz hizalama isteği.',
          requestId: request.id,
        },
      });
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
      select: { duration: true },
    });
    if (!track?.duration)
      return reply.status(422).send({
        error: {
          code: 'DURATION_REQUIRED',
          message: 'Hizalama için parça süresi gerekli.',
          requestId: request.id,
        },
      });
    return {
      content: alignPlainLyrics(
        parsed.data.content,
        track.duration,
        parsed.data.leadInMs,
        parsed.data.endPaddingMs,
      ),
    };
  });

  fastify.post<{ Params: { id: string } }>(
    '/tracks/:id/lyrics/revisions',
    async (request, reply) => {
      const parsed = musicLyricsRevisionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Geçersiz LRC düzeltmesi.',
            requestId: request.id,
          },
        });
      const track = await fastify.prisma.musicTrack.findFirst({
        where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
        select: { lyrics: { select: { id: true } } },
      });
      if (!track?.lyrics)
        return reply.status(404).send({
          error: {
            code: 'LYRICS_NOT_FOUND',
            message: 'Önce ana şarkı sözünü ekleyin.',
            requestId: request.id,
          },
        });
      const revision = await fastify.prisma.musicLyricsRevision.create({
        data: {
          lyricsId: track.lyrics.id,
          sourceName: parsed.data.sourceName,
          content: parsed.data.content,
        },
      });
      return reply
        .status(201)
        .send({ revision: { ...revision, createdAt: revision.createdAt.toISOString() } });
    },
  );

  fastify.post<{ Params: { id: string; revisionId: string } }>(
    '/tracks/:id/lyrics/revisions/:revisionId/apply',
    async (request, reply) => {
      const track = await fastify.prisma.musicTrack.findFirst({
        where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
        select: { lyrics: true },
      });
      if (!track?.lyrics)
        return reply.status(404).send({
          error: {
            code: 'LYRICS_NOT_FOUND',
            message: 'Şarkı sözü bulunamadı.',
            requestId: request.id,
          },
        });
      const revision = await fastify.prisma.musicLyricsRevision.findFirst({
        where: { id: request.params.revisionId, lyricsId: track.lyrics.id, status: 'pending' },
      });
      if (!revision)
        return reply.status(404).send({
          error: {
            code: 'REVISION_NOT_FOUND',
            message: 'Düzeltme bulunamadı.',
            requestId: request.id,
          },
        });
      await fastify.prisma.$transaction([
        fastify.prisma.musicLyricsRevision.create({
          data: {
            lyricsId: track.lyrics.id,
            sourceName: `Yedek · ${track.lyrics.sourceName}`,
            content: track.lyrics.content,
            status: 'backup',
            appliedAt: new Date(),
          },
        }),
        fastify.prisma.musicLyrics.update({
          where: { id: track.lyrics.id },
          data: {
            content: revision.content,
            sourceName: revision.sourceName,
            sourceType: 'community',
            isSynced: parseLrc(revision.content).isSynced,
            offsetMs: parseLrc(revision.content).offsetMs,
          },
        }),
        fastify.prisma.musicLyricsRevision.update({
          where: { id: revision.id },
          data: { status: 'applied', appliedAt: new Date() },
        }),
      ]);
      const lyrics = await fastify.prisma.musicLyrics.findUniqueOrThrow({
        where: { id: track.lyrics.id },
        include: { translations: true, revisions: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
      return { lyrics: formatLyrics(lyrics) };
    },
  );

  fastify.get<{ Params: { id: string } }>('/tracks/:id/lyrics/lrc', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...ownedTrackWhere(request.user!.id) },
      include: { lyrics: true },
    });
    if (!track?.lyrics)
      return reply.status(404).send({
        error: {
          code: 'LYRICS_NOT_FOUND',
          message: 'Şarkı sözü bulunamadı.',
          requestId: request.id,
        },
      });
    const fileName = `${track.title.replace(/[\\/:*?"<>|]/g, '_')}.lrc`;
    return reply
      .type('text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(track.lyrics.content);
  });

  fastify.post<{ Params: { id: string } }>('/tracks/:id/lyrics/sidecar', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
      include: { lyrics: true, driveFile: { select: { localFilePath: true } } },
    });
    if (!track?.lyrics)
      return reply.status(404).send({
        error: {
          code: 'LYRICS_NOT_FOUND',
          message: 'Şarkı sözü bulunamadı.',
          requestId: request.id,
        },
      });
    if (!track.driveFile.localFilePath)
      return reply.status(409).send({
        error: {
          code: 'LOCAL_FILE_REQUIRED',
          message: 'Drive parçaları için LRC indirmeyi kullanın.',
          requestId: request.id,
        },
      });
    const parsedPath = path.parse(track.driveFile.localFilePath);
    const lrcPath = path.join(parsedPath.dir, `${parsedPath.name}.lrc`);
    await fs.promises.writeFile(lrcPath, track.lyrics.content, 'utf8');
    return { path: lrcPath };
  });

  fastify.delete<{ Params: { id: string } }>('/tracks/:id/lyrics', async (request, reply) => {
    const track = await fastify.prisma.musicTrack.findFirst({
      where: { id: request.params.id, ...manageableTrackWhere(request.user!.id) },
      select: { id: true },
    });
    if (!track)
      return reply.status(404).send({
        error: { code: 'TRACK_NOT_FOUND', message: 'Parça bulunamadı.', requestId: request.id },
      });
    await fastify.prisma.musicLyrics.deleteMany({ where: { trackId: track.id } });
    return reply.status(204).send();
  });

  const downloadDisposition = (name: string) => {
    const safeName = name.replace(/[\r\n"]/g, '_');
    const fallback = safeName.replace(/[^\x20-\x7e]/g, '_');
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
  };

  fastify.post('/download-manifest', async (request, reply) => {
    const parsed = musicDownloadManifestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Geçersiz indirme isteği.',
          requestId: request.id,
        },
      });
    const userId = request.user!.id;
    const uniqueTrackIds = [...new Set(parsed.data.trackIds)];
    const tracks = await fastify.prisma.musicTrack.findMany({
      where: { id: { in: uniqueTrackIds }, ...ownedTrackWhere(userId) },
      include: { driveFile: { select: { name: true, size: true, md5Checksum: true } } },
    });
    if (tracks.length !== uniqueTrackIds.length)
      return reply.status(404).send({
        error: {
          code: 'TRACK_NOT_FOUND',
          message: 'İndirilecek parçalardan bazıları bulunamadı.',
          requestId: request.id,
        },
      });
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    return {
      format: parsed.data.format,
      items: parsed.data.trackIds.map((trackId) => {
        const track = tracksById.get(trackId)!;
        return {
          trackId,
          url: `/api/music/tracks/${trackId}/download?format=${parsed.data.format}`,
          fileName:
            parsed.data.format === 'aac'
              ? `${track.title.replace(/[\\/:*?"<>|]/g, '_')}.m4a`
              : track.driveFile.name,
          sizeBytes:
            parsed.data.format === 'original' && track.driveFile.size !== null
              ? track.driveFile.size.toString()
              : null,
          checksum: parsed.data.format === 'original' ? track.driveFile.md5Checksum || null : null,
          resumable: parsed.data.format === 'original',
        };
      }),
    };
  });

  const handleTrackDownload = async (
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: { format?: string };
    }>,
    reply: FastifyReply,
    head = false,
  ) => {
    const format = request.query.format || 'original';
    if (format !== 'original' && format !== 'aac')
      return reply.status(400).send({
        error: {
          code: 'INVALID_DOWNLOAD_FORMAT',
          message: 'Geçersiz indirme formatı.',
          requestId: request.id,
        },
      });

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
    const extension = path.extname(file.name);
    const downloadName =
      format === 'aac'
        ? `${track.title.replace(/[\\/:*?"<>|]/g, '_')}.m4a`
        : extension
          ? file.name
          : `${file.name}.audio`;
    reply
      .header('Content-Disposition', downloadDisposition(downloadName))
      .header('Cache-Control', 'private, no-store');

    if (format === 'aac') {
      if (request.headers.range) {
        return reply.status(416).send({
          error: {
            code: 'RANGE_NOT_SUPPORTED',
            message: 'AAC indirmeleri kaldığı yerden devam ettirilemez.',
            requestId: request.id,
          },
        });
      }
      reply.header('Content-Type', 'audio/mp4').header('Accept-Ranges', 'none');
      if (head) return reply.send();
      const source =
        file.storageType === 'local' && file.localFilePath
          ? { input: file.localFilePath, inputOptions: [] as string[] }
          : (() => {
              const remote = driveSourceInput(fastify, file, userId);
              return { input: remote.url, inputOptions: remote.inputOptions };
            })();
      try {
        const output = fastify.transcodeService.createTranscodedStream(source.input, {
          audioOnly: true,
          realtime: false,
          inputOptions: source.inputOptions,
        });
        request.raw.once('aborted', output.kill);
        reply.raw.once('close', output.kill);
        return reply.send(output.stream);
      } catch (error) {
        if (error instanceof Error && error.message === 'TRANSCODE_CAPACITY_REACHED')
          return reply
            .header('Retry-After', '3')
            .status(503)
            .send({
              error: {
                code: 'TRANSCODE_CAPACITY_REACHED',
                message: 'Dönüştürme kapasitesi dolu. Daha sonra tekrar deneyin.',
                requestId: request.id,
              },
            });
        throw error;
      }
    }

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
        .header('Content-Type', resolveMusicContentType(file.name, file.mimeType))
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', Math.max(0, end - start + 1));
      if (localResolution.kind === 'range')
        reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      return head
        ? reply.send()
        : reply.send(fs.createReadStream(file.localFilePath, { start, end }));
    }

    if (head) {
      reply
        .header('Content-Type', resolveMusicContentType(file.name, file.mimeType))
        .header('Accept-Ranges', 'bytes');
      if (size !== null) reply.header('Content-Length', size);
      return reply.send();
    }

    const transfer = beginDirectTransfer(userId, 'download', request, reply);
    if (!transfer) return transferCapacityError(request, reply);

    let token: string;
    try {
      ({ accessToken: token } = await fastify.driveAccessService.getAccess(userId, file));
    } catch {
      transfer.release();
      return reply.status(401).send({
        error: {
          code: 'GOOGLE_AUTH_REQUIRED',
          message: 'Google Drive bağlantısını yenileyin.',
          requestId: request.id,
        },
      });
    }
    if (transfer.signal.aborted) {
      transfer.release();
      return reply.status(499).send();
    }
    const upstreamRange =
      resolution.kind === 'range' ? `bytes=${resolution.start}-${resolution.end}` : range;
    let upstream: Awaited<ReturnType<typeof fastify.driveService.createMediaStream>>;
    try {
      upstream = await fastify.driveService.createMediaStream(
        token,
        file.googleDriveFileId!,
        upstreamRange,
        transfer.signal,
      );
    } catch (error) {
      transfer.release();
      throw error;
    }
    upstream.stream.on('error', (streamError) => {
      transfer.abort();
      if (!reply.raw.writableEnded) reply.raw.destroy(streamError);
    });
    for (const [key, value] of Object.entries(upstream.headers)) reply.header(key, value);
    reply
      .header('Content-Disposition', downloadDisposition(downloadName))
      .header(
        'Content-Type',
        resolveMusicContentType(file.name, file.mimeType, upstream.headers['content-type']),
      )
      .header('Accept-Ranges', 'bytes')
      .status(upstream.status);
    return reply.send(upstream.stream);
  };

  fastify.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/tracks/:id/download',
    (request, reply) => handleTrackDownload(request, reply),
  );
  fastify.head<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/tracks/:id/download',
    (request, reply) => handleTrackDownload(request, reply, true),
  );

  const handleTrackStream = async (
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: { transcode?: string; start?: string; clientId?: string };
    }>,
    reply: FastifyReply,
    head = false,
  ) => {
    const userId = request.user!.id;
    const client = musicPlaybackClientQuerySchema.shape.clientId.safeParse(request.query.clientId || 'legacy');
    if (!client.success) return reply.status(400).send({ error: { code: 'INVALID_PLAYBACK_CLIENT', message: 'Geçersiz oynatıcı kimliği.', requestId: request.id } });
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
      if (head)
        return reply
          .header('Content-Type', 'audio/mp4')
          .header('Accept-Ranges', 'none')
          .header('Cache-Control', 'no-store')
          .send();
      const source =
        file.storageType === 'local' && file.localFilePath
          ? { input: file.localFilePath, inputOptions: [] as string[] }
          : (() => {
              const remote = driveSourceInput(fastify, file, userId);
              return { input: remote.url, inputOptions: remote.inputOptions };
            })();
      try {
        const output = fastify.transcodeService.createTranscodedStream(source.input, {
          audioOnly: true,
          startSeconds,
          inputOptions: source.inputOptions,
          ownerSessionId: `music_${createHash('sha256').update(`${userId}:${client.data}`).digest('hex').slice(0, 32)}`,
        });
        reply
          .header('Content-Type', 'audio/mp4')
          .header('Accept-Ranges', 'none')
          .header('Cache-Control', 'no-store');
        // IncomingMessage `close` may fire after the GET request itself has
        // been consumed while the response is still streaming. Killing FFmpeg
        // there truncated the fragmented MP4 before AVPlayer could decode it.
        request.raw.once('aborted', output.kill);
        reply.raw.once('close', output.kill);
        return reply.send(output.stream);
      } catch (error) {
        if (error instanceof Error && error.message === 'TRANSCODE_CAPACITY_REACHED')
          return reply
            .header('Retry-After', '3')
            .status(503)
            .send({
              error: {
                code: 'TRANSCODE_CAPACITY_REACHED',
                message: 'Dönüştürme kapasitesi dolu. Daha sonra tekrar deneyin.',
                requestId: request.id,
              },
            });
        throw error;
      }
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
        .header('Content-Type', resolveMusicContentType(file.name, file.mimeType))
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', Math.max(0, end - start + 1));
      if (localResolution.kind === 'range')
        reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      return head
        ? reply.send()
        : reply.send(fs.createReadStream(file.localFilePath, { start, end }));
    }
    if (head) {
      reply
        .header('Content-Type', resolveMusicContentType(file.name, file.mimeType))
        .header('Accept-Ranges', 'bytes');
      if (size !== null) reply.header('Content-Length', size);
      return reply.send();
    }

    const transfer = beginDirectTransfer(userId, client.data, request, reply);
    if (!transfer) {
      fastify.log.warn({ userId, clientId: client.data, code: 'MUSIC_TRANSFER_CAPACITY_REACHED' }, 'Music transfer capacity reached');
      return transferCapacityError(request, reply);
    }

    let token: string;
    try {
      ({ accessToken: token } = await fastify.driveAccessService.getAccess(userId, file));
    } catch {
      transfer.release();
      return reply.status(401).send({
        error: {
          code: 'GOOGLE_AUTH_REQUIRED',
          message: 'Google Drive bağlantısını yenileyin.',
          requestId: request.id,
        },
      });
    }
    if (transfer.signal.aborted) {
      transfer.release();
      return reply.status(499).send();
    }
    const upstreamRange =
      resolution.kind === 'range' ? `bytes=${resolution.start}-${resolution.end}` : range;
    let upstream: Awaited<ReturnType<typeof fastify.driveService.createMediaStream>>;
    try {
      upstream = await fastify.driveService.createMediaStream(
        token,
        file.googleDriveFileId!,
        upstreamRange,
        transfer.signal,
      );
    } catch (error) {
      transfer.release();
      throw error;
    }
    upstream.stream.on('error', (streamError) => {
      request.log.error(
        {
          event: 'music_stream_error',
          side: 'server',
          code: 'UPSTREAM_STREAM_ERROR',
          userId,
          clientId: client.data,
          err: streamError,
        },
        'Music upstream stream failed',
      );
      transfer.abort();
      if (!reply.raw.writableEnded) reply.raw.destroy(streamError);
    });
    for (const [key, value] of Object.entries(upstream.headers)) reply.header(key, value);
    reply
      .header(
        'Content-Type',
        resolveMusicContentType(file.name, file.mimeType, upstream.headers['content-type']),
      )
      .header('Accept-Ranges', 'bytes')
      .status(upstream.status);
    return reply.send(upstream.stream);
  };
  fastify.get<{ Params: { id: string }; Querystring: { transcode?: string; start?: string; clientId?: string } }>(
    '/tracks/:id/stream',
    (request, reply) => handleTrackStream(request, reply),
  );
  fastify.head<{ Params: { id: string }; Querystring: { transcode?: string; start?: string; clientId?: string } }>(
    '/tracks/:id/stream',
    (request, reply) => handleTrackStream(request, reply, true),
  );
};

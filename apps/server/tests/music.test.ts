import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import {
  AUDIO_EXTENSIONS,
  cleanMusicFilenameTitle,
  isAudioFilename,
  isPlaylistFilename,
} from '../src/services/music-metadata.service';
import { alignPlainLyrics, parseLrc } from '../src/services/music-lyrics.service';
import { resolveMusicContentType } from '../src/utils/music-format';

describe('Music library', () => {
  let app: FastifyInstance;
  let cookie: string;
  let libraryId: string;
  let trackId: string;
  let fixturePath: string;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
    const user = await app.authService.ensureAdminUserExists();
    fixturePath = path.join(os.tmpdir(), `cinedrive-music-${randomUUID()}.mp3`);
    fs.writeFileSync(fixturePath, Buffer.from(Array.from({ length: 256 }, (_, index) => index)));
    const library = await app.prisma.library.create({
      data: {
        userId: user.id,
        name: `Music ${randomUUID()}`,
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: os.tmpdir(),
      },
    });
    libraryId = library.id;
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId,
        storageType: 'local',
        localFilePath: fixturePath,
        name: '01 - Test Song.mp3',
        mimeType: 'audio/mpeg',
        size: 256n,
        status: 'active',
        mediaContainer: 'flac',
        audioCodec: 'flac',
        audioChannels: 2,
        audioSampleRate: 96000,
        audioBitrate: 2400000,
        audioBitDepth: 24,
        audioLossless: true,
        mediaDuration: 120,
      },
    });
    const artist = await app.prisma.musicArtist.create({
      data: { userId: user.id, name: 'Test Artist', normalizedName: `test artist ${randomUUID()}` },
    });
    const album = await app.prisma.musicAlbum.create({
      data: {
        userId: user.id,
        artistId: artist.id,
        title: 'Test Album',
        normalizedTitle: `test album ${randomUUID()}`,
        releaseType: 'album',
      },
    });
    const track = await app.prisma.musicTrack.create({
      data: {
        libraryId,
        driveFileId: file.id,
        albumId: album.id,
        primaryArtistId: artist.id,
        title: 'Test Song',
        normalizedTitle: 'test song',
        duration: 120,
        trackNumber: 1,
        replayGainTrackDb: -5.2,
        replayGainTrackPeak: 0.98,
      },
    });
    trackId = track.id;
    await app.prisma.musicTrackArtist.create({ data: { trackId, artistId: artist.id } });
    await app.prisma.musicTrackCredit.create({
      data: { trackId, name: 'Fixture Composer', role: 'composer', source: 'tag' },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.prisma.library.deleteMany({ where: { id: libraryId } });
    await app.prisma.musicAlbum.deleteMany({ where: { tracks: { none: {} } } });
    await app.prisma.musicArtist.deleteMany({
      where: { trackCredits: { none: {} }, albums: { none: {} } },
    });
    await app.close();
    fs.rmSync(fixturePath, { force: true });
    fs.rmSync(fixturePath.replace(/\.mp3$/i, '.lrc'), { force: true });
  });

  it('cleans numbered music filenames', () => {
    expect(cleanMusicFilenameTitle('CD2 01 - Hello.World.mp3')).toBe('Hello World');
    for (const extension of AUDIO_EXTENSIONS)
      expect(isAudioFilename(`track${extension}`)).toBe(true);
    expect(isAudioFilename('movie.mp4')).toBe(false);
    expect(isPlaylistFilename('playlist.m3u8', 'audio/mpegurl')).toBe(true);
    expect(isPlaylistFilename('playlist.pls')).toBe(true);
    expect(isPlaylistFilename('track.mp3', 'audio/mpeg')).toBe(false);
    expect(resolveMusicContentType('track.flac', 'application/octet-stream')).toBe('audio/flac');
    expect(resolveMusicContentType('track.aac', 'audio/mp4')).toBe('audio/aac');
  });

  it('returns technical quality and ReplayGain metadata for music tracks', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/music/tracks',
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).tracks[0]).toMatchObject({
      id: trackId,
      audio: {
        container: 'flac',
        codec: 'flac',
        channels: 2,
        sampleRate: 96000,
        bitrate: 2400000,
        bitDepth: 24,
        lossless: true,
        replayGainTrackDb: -5.2,
        replayGainTrackPeak: 0.98,
      },
      credits: [{ name: 'Fixture Composer', role: 'composer', source: 'tag' }],
      source: {
        fileName: '01 - Test Song.mp3',
        localPath: fixturePath,
      },
    });
  });

  it('downloads original tracks with HEAD and Range semantics', async () => {
    const head = await app.inject({
      method: 'HEAD',
      url: `/api/music/tracks/${trackId}/download?format=original`,
      cookies: { session_id: cookie },
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe('256');
    expect(head.headers['accept-ranges']).toBe('bytes');
    expect(head.headers['content-disposition']).toContain('01%20-%20Test%20Song.mp3');

    const range = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/download?format=original`,
      headers: { range: 'bytes=10-19' },
      cookies: { session_id: cookie },
    });
    expect(range.statusCode).toBe(206);
    expect(range.headers['content-range']).toBe('bytes 10-19/256');
    expect(range.rawPayload).toEqual(
      Buffer.from(Array.from({ length: 10 }, (_, index) => index + 10)),
    );
  });

  it('validates download format and ownership', async () => {
    const invalid = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/download?format=wav`,
      cookies: { session_id: cookie },
    });
    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body).error.code).toBe('INVALID_DOWNLOAD_FORMAT');

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/download`,
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('uses an unthrottled audio-only transcode for AAC downloads', async () => {
    const kill = vi.fn();
    const transcode = vi
      .spyOn(app.transcodeService, 'createTranscodedStream')
      .mockReturnValue({ stream: Readable.from(Buffer.from('aac')), kill });
    const response = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/download?format=aac`,
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('audio/mp4');
    expect(response.headers['accept-ranges']).toBe('none');
    expect(response.body).toBe('aac');
    expect(transcode).toHaveBeenCalledWith(
      fixturePath,
      expect.objectContaining({ audioOnly: true, realtime: false }),
    );
    expect(kill).toHaveBeenCalled();
  });

  it('edits and locks metadata with manual credits', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/music/tracks/${trackId}/metadata`,
      cookies: { session_id: cookie },
      payload: {
        title: 'Edited Song',
        artist: 'Edited Artist',
        album: 'Edited EP',
        year: 2025,
        genres: ['Jazz', 'Vocal'],
        discNumber: 2,
        trackNumber: 4,
        releaseType: 'ep',
        metadataLocked: true,
        credits: [
          { name: 'Manual Writer', role: 'lyricist' },
          { name: 'Manual Producer', role: 'producer' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).track).toMatchObject({
      title: 'Edited Song',
      year: 2025,
      discNumber: 2,
      trackNumber: 4,
      metadataLocked: true,
      primaryArtist: { name: 'Edited Artist' },
      album: { title: 'Edited EP', releaseType: 'ep' },
      credits: [
        { name: 'Manual Writer', role: 'lyricist', source: 'manual' },
        { name: 'Manual Producer', role: 'producer', source: 'manual' },
      ],
    });
  });

  it('returns premium album summaries and disc information', async () => {
    const albumId = (
      await app.prisma.musicTrack.findUniqueOrThrow({
        where: { id: trackId },
        select: { albumId: true },
      })
    ).albumId!;
    const response = await app.inject({
      method: 'GET',
      url: `/api/music/albums/${albumId}`,
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).album).toMatchObject({
      releaseType: 'album',
      totalDuration: 120,
      discCount: 1,
      qualitySummary: { formats: ['FLAC'], lossless: true, hiRes: true },
    });
  });

  it('uses persisted artist artwork instead of borrowing an album cover', async () => {
    const track = await app.prisma.musicTrack.findUniqueOrThrow({
      where: { id: trackId },
      select: { primaryArtistId: true, albumId: true, library: { select: { userId: true } } },
    });
    const artistArtwork = await app.prisma.musicArtwork.create({
      data: {
        userId: track.library.userId,
        mimeType: 'image/jpeg',
        data: Uint8Array.from([1, 2, 3]),
        checksum: randomUUID(),
      },
    });
    const albumArtwork = await app.prisma.musicArtwork.create({
      data: {
        userId: track.library.userId,
        mimeType: 'image/jpeg',
        data: Uint8Array.from([4, 5, 6]),
        checksum: randomUUID(),
      },
    });
    await app.prisma.musicArtist.update({
      where: { id: track.primaryArtistId! },
      data: { artworkId: artistArtwork.id, artworkSource: 'manual', artworkLocked: true },
    });
    await app.prisma.musicAlbum.update({
      where: { id: track.albumId! },
      data: { artworkId: albumArtwork.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/music/artists',
      cookies: { session_id: cookie },
    });

    expect(response.statusCode).toBe(200);
    const responseArtist = JSON.parse(response.body).artists.find(
      (artist: { id: string }) => artist.id === track.primaryArtistId,
    );
    expect(responseArtist.artworkUrl).toBe(`/api/music/artwork/${artistArtwork.id}`);
  });

  it('conservatively rematches MusicBrainz recording credits', async () => {
    const recordingId = randomUUID();
    const producerId = randomUUID();
    const composerId = randomUUID();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            recordings: [
              {
                id: recordingId,
                score: 100,
                title: 'Test Song',
                length: 120000,
                'artist-credit': [{ artist: { name: 'Test Artist' } }],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: recordingId,
            relations: [
              { type: 'producer', artist: { id: producerId, name: 'Online Producer' } },
              {
                type: 'performance',
                work: {
                  relations: [
                    { type: 'composer', artist: { id: composerId, name: 'Online Composer' } },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ 'release-groups': [] }), { status: 200 }),
      );
    const response = await app.inject({
      method: 'POST',
      url: `/api/music/tracks/${trackId}/rematch`,
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      matchStatus: 'matched',
      track: {
        musicbrainzRecordingId: recordingId,
      },
    });
    expect(body.track.credits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Online Producer',
          role: 'producer',
          source: 'musicbrainz',
        }),
        expect.objectContaining({
          name: 'Online Composer',
          role: 'composer',
          source: 'musicbrainz',
        }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('parses synced and plain LRC lyrics with metadata and offset', () => {
    const synced = parseLrc(
      '[ar:Test Artist]\n[offset:+100]\n[00:01.20][00:03.000]First line\n[00:05.50]Second line',
    );
    expect(synced.isSynced).toBe(true);
    expect(synced.metadata.ar).toBe('Test Artist');
    expect(synced.offsetMs).toBe(100);
    expect(synced.lines).toEqual([
      { timeMs: 1300, text: 'First line' },
      { timeMs: 3100, text: 'First line' },
      { timeMs: 5600, text: 'Second line' },
    ]);
    expect(parseLrc('First line\nSecond line').lines).toEqual([
      { timeMs: null, text: 'First line' },
      { timeMs: null, text: 'Second line' },
    ]);
  });

  it('parses enhanced word timestamps and creates a conservative alignment draft', () => {
    expect(parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world').lines).toEqual([
      {
        timeMs: 1000,
        text: 'Hello world',
        words: [
          { timeMs: 1000, text: 'Hello' },
          { timeMs: 1500, text: 'world' },
        ],
      },
    ]);
    expect(alignPlainLyrics('First line\nSecond line', 10, 1000, 1000)).toBe(
      '[00:01.00] First line\n[00:09.00] Second line',
    );
  });

  it('stores and serves owned track lyrics', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/music/tracks/${trackId}/lyrics`,
      cookies: { session_id: cookie },
      payload: { sourceName: 'Test Song.tr.lrc', content: '[la:tr]\n[00:01.00]Merhaba' },
    });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/lyrics`,
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).lyrics).toMatchObject({
      trackId,
      language: 'tr',
      isSynced: true,
      lines: [{ timeMs: 1000, text: 'Merhaba' }],
    });
  });

  it('stores translation and romanization layers and exports a local sidecar', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/music/tracks/${trackId}/lyrics`,
      cookies: { session_id: cookie },
      payload: {
        content: '[00:01.00]Merhaba',
        translatedContent: '[00:01.00]Hello',
        romanizedContent: '[00:01.00]Merhaba',
        sourceName: 'manual.lrc',
        language: 'tr',
        translationLanguage: 'en',
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body).lyrics).toMatchObject({
      translationLanguage: 'en',
      translatedLines: [{ timeMs: 1000, text: 'Hello' }],
      romanizedLines: [{ timeMs: 1000, text: 'Merhaba' }],
    });

    const exported = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/lyrics/lrc`,
      cookies: { session_id: cookie },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('[00:01.00]Merhaba');

    const sidecar = await app.inject({
      method: 'POST',
      url: `/api/music/tracks/${trackId}/lyrics/sidecar`,
      cookies: { session_id: cookie },
    });
    expect(sidecar.statusCode).toBe(200);
    expect(fs.readFileSync(fixturePath.replace(/\.mp3$/i, '.lrc'), 'utf8')).toContain('Merhaba');
  });

  it('imports a community LRC correction, previews it, and applies it with a backup', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/music/tracks/${trackId}/lyrics`,
      cookies: { session_id: cookie },
      payload: { sourceName: 'original.lrc', content: '[00:01.00]Original' },
    });
    const imported = await app.inject({
      method: 'POST',
      url: `/api/music/tracks/${trackId}/lyrics/revisions`,
      cookies: { session_id: cookie },
      payload: { sourceName: 'community.lrc', content: '[00:01.20]Corrected' },
    });
    expect(imported.statusCode).toBe(201);
    const revisionId = JSON.parse(imported.body).revision.id;
    const applied = await app.inject({
      method: 'POST',
      url: `/api/music/tracks/${trackId}/lyrics/revisions/${revisionId}/apply`,
      cookies: { session_id: cookie },
    });
    expect(applied.statusCode).toBe(200);
    expect(JSON.parse(applied.body).lyrics).toMatchObject({
      sourceName: 'community.lrc',
      lines: [{ timeMs: 1200, text: 'Corrected' }],
    });
    expect(JSON.parse(applied.body).lyrics.revisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'backup' }),
        expect.objectContaining({ status: 'applied' }),
      ]),
    );
  });

  it('returns weekly Replay listening summaries', async () => {
    const user = await app.authService.ensureAdminUserExists();
    await app.prisma.musicHistory.create({
      data: { userId: user.id, trackId, listenedSeconds: 75 },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/music/replay?period=week',
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      period: 'week',
      totalSeconds: 75,
      totalPlays: 1,
      uniqueTracks: 1,
      topTracks: [{ track: { id: trackId }, seconds: 75, plays: 1 }],
    });
  });

  it('accepts small browser and scanner duration drift in listening history', async () => {
    await app.prisma.musicTrack.update({ where: { id: trackId }, data: { duration: 4 } });

    const tooShort = await app.inject({
      method: 'POST',
      url: '/api/music/history',
      cookies: { session_id: cookie },
      payload: { trackId, listenedSeconds: 3.4 },
    });
    expect(tooShort.statusCode).toBe(400);
    expect(JSON.parse(tooShort.body).error.code).toBe('LISTEN_THRESHOLD_NOT_MET');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/music/history',
      cookies: { session_id: cookie },
      payload: { trackId, listenedSeconds: 3.7 },
    });
    expect(accepted.statusCode).toBe(201);
  });

  it('archives a lower-quality duplicate, replaces playlist items, and undoes the action', async () => {
    const original = await app.prisma.musicTrack.findUniqueOrThrow({
      where: { id: trackId },
      include: { driveFile: true },
    });
    const duplicatePath = path.join(os.tmpdir(), `cinedrive-music-duplicate-${randomUUID()}.mp3`);
    fs.writeFileSync(duplicatePath, Buffer.alloc(64));
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId,
        storageType: 'local',
        localFilePath: duplicatePath,
        name: 'duplicate.mp3',
        mimeType: 'audio/mpeg',
        status: 'active',
        audioCodec: 'mp3',
        audioBitrate: 128000,
      },
    });
    const duplicate = await app.prisma.musicTrack.create({
      data: {
        libraryId,
        driveFileId: file.id,
        albumId: original.albumId,
        primaryArtistId: original.primaryArtistId,
        title: original.title,
        normalizedTitle: original.normalizedTitle,
        duration: original.duration,
      },
    });
    const user = await app.authService.ensureAdminUserExists();
    const playlist = await app.prisma.musicPlaylist.create({
      data: { userId: user.id, name: 'Duplicates' },
    });
    const item = await app.prisma.musicPlaylistItem.create({
      data: { playlistId: playlist.id, trackId: duplicate.id, position: 0 },
    });
    const archived = await app.inject({
      method: 'POST',
      url: '/api/music/maintenance/duplicates/archive',
      cookies: { session_id: cookie },
      payload: { keepTrackId: trackId, archiveTrackId: duplicate.id, replacePlaylistItems: true },
    });
    expect(archived.statusCode).toBe(200);
    expect(await app.prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      status: 'archived',
    });
    expect(
      await app.prisma.musicPlaylistItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ trackId });
    const action = await app.prisma.musicMaintenanceAction.findFirstOrThrow({
      where: { targetId: duplicate.id },
    });
    const undone = await app.inject({
      method: 'POST',
      url: `/api/music/maintenance/actions/${action.id}/undo`,
      cookies: { session_id: cookie },
    });
    expect(undone.statusCode).toBe(200);
    expect(await app.prisma.driveFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      status: 'active',
    });
    expect(
      await app.prisma.musicPlaylistItem.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ trackId: duplicate.id });
    fs.rmSync(duplicatePath, { force: true });
  });

  it('builds personalized discovery, continue listening, and artist radio', async () => {
    const user = await app.authService.ensureAdminUserExists();
    await app.prisma.musicHistory.create({
      data: { userId: user.id, trackId, listenedSeconds: 45 },
    });
    await app.prisma.musicPlaybackState.upsert({
      where: { userId: user.id },
      create: { userId: user.id, currentTrackId: trackId, positionSeconds: 38 },
      update: { currentTrackId: trackId, positionSeconds: 38 },
    });
    const discovery = await app.inject({
      method: 'GET',
      url: '/api/music/discovery',
      cookies: { session_id: cookie },
    });
    expect(discovery.statusCode).toBe(200);
    expect(JSON.parse(discovery.body)).toMatchObject({
      continueListening: { track: { id: trackId }, positionSeconds: 38 },
      mixes: expect.arrayContaining([
        expect.objectContaining({ type: 'daily', tracks: expect.any(Array) }),
      ]),
    });
    const artistId = (
      await app.prisma.musicTrack.findUniqueOrThrow({
        where: { id: trackId },
        select: { primaryArtistId: true },
      })
    ).primaryArtistId!;
    const radio = await app.inject({
      method: 'GET',
      url: `/api/music/radio/${artistId}`,
      cookies: { session_id: cookie },
    });
    expect(radio.statusCode).toBe(200);
    expect(JSON.parse(radio.body).mix).toMatchObject({
      type: 'artist-radio',
      tracks: [expect.objectContaining({ id: trackId })],
    });
  });

  it('saves a generated mix as an owned playlist in one operation', async () => {
    const saved = await app.inject({
      method: 'POST',
      url: '/api/music/playlists/from-mix',
      cookies: { session_id: cookie },
      payload: {
        name: 'Günlük Keşif',
        description: 'CineDrive Mix',
        trackIds: [trackId, trackId],
      },
    });
    expect(saved.statusCode).toBe(201);
    expect(JSON.parse(saved.body).playlist).toMatchObject({
      name: 'Günlük Keşif',
      itemCount: 1,
    });
    const playlist = await app.prisma.musicPlaylist.findFirstOrThrow({
      where: { name: 'Günlük Keşif' },
      include: { items: true },
    });
    expect(playlist.items).toEqual([expect.objectContaining({ trackId, position: 0 })]);
  });

  it('creates and batch-updates playlists while preserving track order and duplicates', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/music/playlists/from-tracks',
      cookies: { session_id: cookie },
      payload: { name: 'Kuyruk', trackIds: [trackId, trackId] },
    });
    expect(created.statusCode).toBe(201);
    expect(JSON.parse(created.body).playlist).toMatchObject({ name: 'Kuyruk', itemCount: 2 });
    const playlistId = JSON.parse(created.body).playlist.id;

    const added = await app.inject({
      method: 'POST',
      url: `/api/music/playlists/${playlistId}/items/batch`,
      cookies: { session_id: cookie },
      payload: { trackIds: [trackId, trackId] },
    });
    expect(added.statusCode).toBe(201);
    expect(JSON.parse(added.body)).toEqual({ added: 2 });

    const playlist = await app.prisma.musicPlaylist.findUniqueOrThrow({
      where: { id: playlistId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    expect(playlist.items.map((item) => [item.trackId, item.position])).toEqual([
      [trackId, 0],
      [trackId, 1],
      [trackId, 2],
      [trackId, 3],
    ]);
  });

  it('reports maintenance issues and applies owned bulk metadata updates', async () => {
    const report = await app.inject({
      method: 'GET',
      url: '/api/music/maintenance',
      cookies: { session_id: cookie },
    });
    expect(report.statusCode).toBe(200);
    expect(JSON.parse(report.body)).toMatchObject({
      totals: { missingArtwork: 1, missingMetadata: 1 },
      missingMetadata: [expect.objectContaining({ id: trackId, confidence: expect.any(Number) })],
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/music/maintenance/tracks',
      cookies: { session_id: cookie },
      payload: {
        trackIds: [trackId],
        artist: 'Bulk Artist',
        album: 'Correct Album',
        albumArtist: 'Bulk Artist',
        genres: ['Jazz'],
        year: 2024,
        metadataLocked: true,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).updated).toBe(1);
    expect(
      await app.prisma.musicTrack.findUniqueOrThrow({
        where: { id: trackId },
        include: { primaryArtist: true, album: true },
      }),
    ).toMatchObject({
      genres: '["Jazz"]',
      year: 2024,
      metadataLocked: true,
      primaryArtist: { name: 'Bulk Artist' },
      album: { title: 'Correct Album' },
    });
  });

  it('groups true duplicates by acoustic fingerprint instead of tags', async () => {
    const original = await app.prisma.musicTrack.findUniqueOrThrow({ where: { id: trackId } });
    const duplicateFile = await app.prisma.driveFile.create({
      data: {
        libraryId,
        storageType: 'local',
        localFilePath: `${fixturePath}.duplicate`,
        name: 'Completely Different Title.mp3',
        mimeType: 'audio/mpeg',
        size: 128n,
        status: 'active',
        audioCodec: 'mp3',
        audioBitrate: 128000,
        mediaDuration: 120,
      },
    });
    const duplicate = await app.prisma.musicTrack.create({
      data: {
        libraryId,
        driveFileId: duplicateFile.id,
        title: 'Completely Different Title',
        normalizedTitle: 'completely different title',
        duration: 120,
      },
    });
    await app.prisma.musicFingerprint.createMany({
      data: [
        {
          trackId: original.id,
          fingerprint: 'same-audio',
          fingerprintHash: 'hash-1',
          duration: 120,
          status: 'analyzed',
        },
        {
          trackId: duplicate.id,
          fingerprint: 'same-audio',
          fingerprintHash: 'hash-1',
          duration: 120,
          status: 'analyzed',
        },
      ],
    });

    const report = await app.inject({
      method: 'GET',
      url: '/api/music/maintenance',
      cookies: { session_id: cookie },
    });
    expect(report.statusCode).toBe(200);
    expect(JSON.parse(report.body)).toMatchObject({
      totals: { acousticDuplicates: 1 },
      acousticDuplicates: [
        {
          tracks: expect.arrayContaining([
            expect.objectContaining({ id: trackId }),
            expect.objectContaining({ id: duplicate.id }),
          ]),
          recommendedTrackId: trackId,
        },
      ],
    });
  });

  it('finds, validates, and caches lyrics automatically from LRCLIB', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 42,
          trackName: 'Test Song',
          artistName: 'Test Artist',
          albumName: 'Test Album',
          duration: 120,
          instrumental: false,
          plainLyrics: 'Hello world',
          syncedLyrics: '[00:01.00]Hello world',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/music/tracks/${trackId}/lyrics/lookup`,
      cookies: { session_id: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      lookupStatus: 'found',
      lyrics: {
        trackId,
        sourceName: 'LRCLIB #42',
        isSynced: true,
        lines: [{ timeMs: 1000, text: 'Hello world' }],
      },
    });
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get('track_name')).toBe('Test Song');
    expect(requestedUrl.searchParams.get('duration')).toBe('120');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'User-Agent': expect.stringContaining('CineDrive') },
    });
  });

  it('uses a unique duration-matched LRCLIB search fallback', async () => {
    const title = `Rare Song ${randomUUID()}`;
    await app.prisma.musicTrack.update({ where: { id: trackId }, data: { title } });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 77,
              trackName: title,
              artistName: 'Test Artist',
              albumName: 'A Different Edition',
              duration: 121,
              instrumental: false,
              plainLyrics: 'Fallback line',
              syncedLyrics: null,
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const response = await app.inject({
      method: 'POST',
      url: `/api/music/tracks/${trackId}/lyrics/lookup`,
      cookies: { session_id: cookie },
    });
    expect(JSON.parse(response.body)).toMatchObject({
      lookupStatus: 'found',
      lyrics: { sourceName: 'LRCLIB #77', isSynced: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/search?');
  });

  it('lists owned tracks and serves byte ranges', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/music/tracks',
      cookies: { session_id: cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).tracks[0].title).toBe('Test Song');

    const stream = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/stream`,
      headers: { range: 'bytes=10-19' },
      cookies: { session_id: cookie },
    });
    expect(stream.statusCode).toBe(206);
    expect(stream.headers['content-range']).toBe('bytes 10-19/256');
    expect(stream.rawPayload).toHaveLength(10);
  });

  it('reports remote stream length on HEAD without opening a Drive transfer', async () => {
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: trackId } },
      data: {
        storageType: 'gdrive',
        localFilePath: null,
        googleDriveFileId: `music-head-${randomUUID()}`,
      },
    });
    const access = vi.spyOn(app.driveAccessService, 'getAccess');
    const mediaStream = vi.spyOn(app.driveService, 'createMediaStream');

    const response = await app.inject({
      method: 'HEAD',
      url: `/api/music/tracks/${trackId}/stream`,
      cookies: { session_id: cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-length']).toBe('256');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(access).not.toHaveBeenCalled();
    expect(mediaStream).not.toHaveBeenCalled();
  });

  it('cancels remote Drive music transfers through an AbortSignal', async () => {
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: trackId } },
      data: {
        storageType: 'gdrive',
        localFilePath: null,
        googleDriveFileId: `music-stream-${randomUUID()}`,
      },
    });
    vi.spyOn(app.driveAccessService, 'getAccess').mockResolvedValue({
      accessToken: 'music-access-token',
      connectionId: 'music-connection',
    });
    const mediaStream = vi
      .spyOn(app.driveService, 'createMediaStream')
      .mockImplementation(async (_token, _fileId, _range, _signal) => ({
        stream: Readable.from(Buffer.from('remote-music')),
        status: 206,
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': '12',
          'content-range': `bytes 0-11/256`,
          'accept-ranges': 'bytes',
        },
      }));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/music/tracks/${trackId}/stream`,
        headers: { range: 'bytes=0-11' },
        cookies: { session_id: cookie },
      });
      expect(response.statusCode).toBe(206);
      expect(response.body).toBe('remote-music');
    }

    expect(mediaStream).toHaveBeenCalledTimes(5);
    const signal = mediaStream.mock.calls[0]?.[3];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('limits concurrent remote music transfers per user', async () => {
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: trackId } },
      data: {
        storageType: 'gdrive',
        localFilePath: null,
        googleDriveFileId: `music-capacity-${randomUUID()}`,
      },
    });
    vi.spyOn(app.driveAccessService, 'getAccess').mockResolvedValue({
      accessToken: 'music-access-token',
      connectionId: 'music-connection',
    });
    const streams: PassThrough[] = [];
    vi.spyOn(app.driveService, 'createMediaStream').mockImplementation(async () => {
      const stream = new PassThrough();
      streams.push(stream);
      return {
        stream,
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes' },
      };
    });

    const activeRequests = Array.from({ length: 4 }, () =>
      app.inject({
        method: 'GET',
        url: `/api/music/tracks/${trackId}/stream`,
        cookies: { session_id: cookie },
      }),
    );
    for (let attempt = 0; attempt < 50 && streams.length < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(streams).toHaveLength(4);

    const overflow = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/stream`,
      cookies: { session_id: cookie },
    });
    expect(overflow.statusCode).toBe(429);
    expect(JSON.parse(overflow.body).error.code).toBe('MUSIC_TRANSFER_CAPACITY_REACHED');

    streams.forEach((stream) => stream.end('music'));
    const completed = await Promise.all(activeRequests);
    expect(completed.every((response) => response.statusCode === 200)).toBe(true);
  });

  it('normalizes generic stored MIME types before direct music streaming', async () => {
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: trackId } },
      data: { mimeType: 'application/octet-stream' },
    });
    const stream = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/stream`,
      headers: { range: 'bytes=0-19' },
      cookies: { session_id: cookie },
    });

    expect(stream.statusCode).toBe(206);
    expect(stream.headers['content-type']).toContain('audio/mpeg');
    expect(stream.rawPayload).toHaveLength(20);
  });

  it('serves an iOS-compatible audio transcode until the response closes', async () => {
    const kill = vi.fn();
    const transcode = vi
      .spyOn(app.transcodeService, 'createTranscodedStream')
      .mockReturnValue({ stream: Readable.from(Buffer.from('fragmented-aac')), kill });
    const response = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/stream?transcode=1`,
      headers: { range: 'bytes=0-' },
      cookies: { session_id: cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('audio/mp4');
    expect(response.headers['accept-ranges']).toBe('none');
    expect(response.headers['content-range']).toBeUndefined();
    expect(response.body).toBe('fragmented-aac');
    expect(transcode).toHaveBeenCalledWith(
      fixturePath,
      expect.objectContaining({ audioOnly: true, startSeconds: 0 }),
    );
    expect(kill).toHaveBeenCalled();
  });

  it('returns a structured error when music transcode capacity is full', async () => {
    vi.spyOn(app.transcodeService, 'createTranscodedStream').mockImplementation(() => {
      throw new Error('TRANSCODE_CAPACITY_REACHED');
    });
    const response = await app.inject({
      method: 'GET',
      url: `/api/music/tracks/${trackId}/stream?transcode=1`,
      cookies: { session_id: cookie },
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error.code).toBe('TRANSCODE_CAPACITY_REACHED');
  });

  it('creates playlists and rejects stale playback revisions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/music/playlists',
      cookies: { session_id: cookie },
      payload: { name: 'Road trip' },
    });
    expect(created.statusCode).toBe(201);
    const playlistId = JSON.parse(created.body).playlist.id;
    const added = await app.inject({
      method: 'POST',
      url: `/api/music/playlists/${playlistId}/items`,
      cookies: { session_id: cookie },
      payload: { trackId },
    });
    expect(added.statusCode).toBe(201);
    const addedAgain = await app.inject({
      method: 'POST',
      url: `/api/music/playlists/${playlistId}/items`,
      cookies: { session_id: cookie },
      payload: { trackId },
    });
    expect(addedAgain.statusCode).toBe(201);
    const details = await app.inject({
      method: 'GET',
      url: `/api/music/playlists/${playlistId}`,
      cookies: { session_id: cookie },
    });
    const itemIds = JSON.parse(details.body).playlist.items.map((item: { id: string }) => item.id);
    const reordered = await app.inject({
      method: 'PUT',
      url: `/api/music/playlists/${playlistId}/reorder`,
      cookies: { session_id: cookie },
      payload: { itemIds: [...itemIds].reverse() },
    });
    expect(reordered.statusCode).toBe(200);

    const queueId = randomUUID();
    const state = {
      revision: 0,
      currentTrackId: trackId,
      currentQueueItemId: queueId,
      positionSeconds: 12,
      shuffleEnabled: false,
      repeatMode: 'off',
      queue: [{ id: queueId, trackId, sourceOrder: 0, playOrder: 0 }],
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/music/playback-state',
      cookies: { session_id: cookie },
      payload: state,
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body).revision).toBe(1);
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/music/playback-state',
      cookies: { session_id: cookie },
      payload: state,
    });
    expect(stale.statusCode).toBe(409);
  });
});

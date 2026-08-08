import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import {
  AUDIO_EXTENSIONS,
  cleanMusicFilenameTitle,
  isAudioFilename,
} from '../src/services/music-metadata.service';
import { parseLrc } from '../src/services/music-lyrics.service';

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
        audioCodec: 'mp3',
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
      },
    });
    trackId = track.id;
    await app.prisma.musicTrackArtist.create({ data: { trackId, artistId: artist.id } });
  });

  afterEach(async () => {
    await app.prisma.library.deleteMany({ where: { id: libraryId } });
    await app.prisma.musicAlbum.deleteMany({ where: { tracks: { none: {} } } });
    await app.prisma.musicArtist.deleteMany({
      where: { trackCredits: { none: {} }, albums: { none: {} } },
    });
    await app.close();
    fs.rmSync(fixturePath, { force: true });
  });

  it('cleans numbered music filenames', () => {
    expect(cleanMusicFilenameTitle('CD2 01 - Hello.World.mp3')).toBe('Hello World');
    for (const extension of AUDIO_EXTENSIONS)
      expect(isAudioFilename(`track${extension}`)).toBe(true);
    expect(isAudioFilename('movie.mp4')).toBe(false);
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

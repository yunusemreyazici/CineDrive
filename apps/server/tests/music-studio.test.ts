import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { emptyStudio, selectRecordingVersions } from '../src/services/music-studio.service.js';
import { musicStudioSchema, type PlaylistIntentProviderOutput } from '@cinedrive/shared';
import { MusicAiPlaylistService } from '../src/services/music-ai-playlist.service.js';

describe('recording families', () => {
  it('never inserts an ineligible preferred track and rejects overlapping families', () => {
    const family = { id: randomUUID(), name: 'Song', trackIds: ['a', 'b'], preferredTrackId: 'a' };
    const profile = { ...emptyStudio(), families: [family] };
    expect(selectRecordingVersions([{ id: 'b' }, { id: 'c' }], profile)).toEqual([
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(selectRecordingVersions([{ id: 'b' }, { id: 'a' }], profile)).toEqual([{ id: 'a' }]);
    expect(
      musicStudioSchema.safeParse({
        ...profile,
        families: [family, { ...family, id: randomUUID() }],
      }).success,
    ).toBe(false);
    expect(
      musicStudioSchema.safeParse({
        ...emptyStudio(),
        sessions: [
          {
            id: randomUUID(),
            name: 'Queue',
            trackIds: ['a'],
            index: 1,
            position: 0,
            savedAt: new Date().toISOString(),
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('music studio authenticated collaboration', () => {
  let app: FastifyInstance;
  let owner: { id: string; email: string; cookie: string };
  let guest: typeof owner;
  let stranger: typeof owner;
  let libraryId: string;
  let tracks: string[];
  let playlistId: string;
  const call = (
    path: string,
    user = owner,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/music/studio${path}`,
      cookies: { session_id: user.cookie },
      payload,
    });
  async function user() {
    const email = `studio-${randomUUID()}@example.test`;
    const password = 'studio-test-password';
    const created = await app.authService.createUser({
      email,
      password,
      name: 'Studio Test',
      role: 'user',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    return {
      id: created.id,
      email,
      cookie: login.cookies.find((c) => c.name === 'session_id')!.value,
    };
  }
  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    owner = await user();
    guest = await user();
    stranger = await user();
    const library = await app.prisma.library.create({
      data: {
        userId: owner.id,
        name: 'Studio',
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: '/tmp',
      },
    });
    libraryId = library.id;
    tracks = [];
    for (let i = 0; i < 15; i++) {
      const file = await app.prisma.driveFile.create({
        data: {
          libraryId,
          name: `${i}.mp3`,
          storageType: 'local',
          localFilePath: `/tmp/${randomUUID()}.mp3`,
          mimeType: 'audio/mpeg',
          size: 100n,
          status: 'active',
        },
      });
      const track = await app.prisma.musicTrack.create({
        data: {
          libraryId,
          driveFileId: file.id,
          title: `Track ${i}`,
          normalizedTitle: `track ${i}`,
          duration: 120,
          year: i === 14 ? 1995 : 2005,
          genres: '["pop"]',
          languageCode: 'tr',
          languageSource: 'lyrics_detected',
          languageConfidence: 0.99,
        },
      });
      tracks.push(track.id);
    }
    const playlist = await app.prisma.musicPlaylist.create({
      data: {
        userId: owner.id,
        name: 'Shared',
        items: {
          create: [tracks[0]!, tracks[1]!, tracks[0]!].map((trackId, position) => ({
            trackId,
            position,
          })),
        },
      },
    });
    playlistId = playlist.id;
  });
  afterEach(async () => {
    await app.prisma.user.deleteMany({ where: { id: { in: [owner.id, guest.id, stranger.id] } } });
    await app.close();
  });
  const path = () => `/playlists/${playlistId}`;
  it('previews and accepts revocable links without granting private track access', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: `/api/music/studio${path()}/invitation-link`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await call(path() + '/invitation-link', guest, 'POST')).statusCode).toBe(404);
    const created = await call(path() + '/invitation-link', owner, 'POST');
    expect(created.statusCode).toBe(200);
    const { token } = created.json();
    const stored = await app.prisma.musicPlaylist.findUniqueOrThrow({ where: { id: playlistId } });
    expect(stored.invitationHash).not.toBe(token);
    expect(stored.invitationHash).toHaveLength(64);
    const preview = (await call('/invitations/preview', guest, 'POST', { token })).json();
    expect(preview).toMatchObject({ name: 'Shared', itemCount: 3, joined: false });
    expect(JSON.stringify(preview)).not.toContain(tracks[0]);
    expect((await call('/invitations/accept', guest, 'POST', { token })).statusCode).toBe(200);
    expect((await call('/invitations/accept', guest, 'POST', { token })).statusCode).toBe(200);
    expect(await app.prisma.musicPlaylistMembership.count({ where: { playlistId } })).toBe(1);
    const read = (url: string) => app.inject({ url, cookies: { session_id: guest.cookie } });
    const directory = (await read('/api/music/playlists')).json().playlists;
    expect(directory).toHaveLength(1);
    expect(directory[0]).toMatchObject({
      itemCount: 0,
      trackIds: [],
      collaboration: { role: 'editor', unavailableCount: 3 },
    });
    const detail = (await read(`/api/music/playlists/${playlistId}`)).json().playlist;
    expect(detail.items).toEqual([]);
    expect((await call(path(), guest)).json().canEdit).toBe(false);
    expect(await app.prisma.libraryMembership.count({ where: { userId: guest.id } })).toBe(0);
    await app.prisma.libraryMembership.create({
      data: { libraryId, userId: guest.id, role: 'listener' },
    });
    expect((await read(`/api/music/playlists/${playlistId}`)).json().playlist.items).toHaveLength(
      3,
    );
    const cursor = new Date(Date.now() + 1000).toISOString();
    expect(
      (await read(`/api/music/sync?version=2&cursor=${encodeURIComponent(cursor)}`)).json()
        .playlistIds,
    ).toContain(playlistId);
    await call(path() + `/members/${guest.id}`, owner, 'DELETE');
    expect((await read(`/api/music/playlists/${playlistId}`)).statusCode).toBe(404);
    expect((await read('/api/music/playlists')).json().playlists).toEqual([]);
    expect((await call('/invitations/accept', guest, 'POST', { token })).statusCode).toBe(404);
  });
  it('rotates, expires and revokes links and never upgrades an existing listener', async () => {
    const first = (await call(path() + '/invitation-link', owner, 'POST')).json().token;
    const second = (await call(path() + '/invitation-link', owner, 'POST')).json().token;
    expect((await call('/invitations/preview', guest, 'POST', { token: first })).statusCode).toBe(
      404,
    );
    await call(path() + '/invite', owner, 'POST', { email: guest.email, role: 'listener' });
    await call('/invitations/accept', guest, 'POST', { token: second });
    expect((await call(path(), guest)).json().role).toBe('listener');
    expect((await call(path() + '/invitation-link', guest, 'POST')).statusCode).toBe(403);
    expect((await call(path() + '/invitation-link', guest, 'DELETE')).statusCode).toBe(403);
    await app.prisma.musicPlaylist.update({
      where: { id: playlistId },
      data: { invitationExpiresAt: new Date(0) },
    });
    expect(
      (await call('/invitations/accept', stranger, 'POST', { token: second })).statusCode,
    ).toBe(404);
    const third = (await call(path() + '/invitation-link', owner, 'POST')).json().token;
    await call(path() + '/invitation-link', owner, 'DELETE');
    expect((await call('/invitations/preview', guest, 'POST', { token: third })).statusCode).toBe(
      404,
    );
    expect(
      (await call('/invitations/accept', guest, 'POST', { token: 'invalid' })).statusCode,
    ).toBe(400);
  });
  it('shows accepted participants and persists the real contributor across reorders', async () => {
    await app.prisma.libraryMembership.create({
      data: { libraryId, userId: guest.id, role: 'listener' },
    });
    await call(path() + '/invite', owner, 'POST', { email: guest.email, role: 'editor' });
    expect(
      (
        await app.inject({ url: '/api/music/playlists', cookies: { session_id: guest.cookie } })
      ).json().playlists,
    ).toEqual([]);
    await call(path() + '/accept', guest, 'POST');
    const before = (await call(path(), guest)).json();
    expect(before.participants).toHaveLength(2);
    expect(before.members).toEqual([]); // Preserve the legacy owner-only management field.
    const added = { id: randomUUID(), trackId: tracks[2]! };
    const items = [
      ...before.playlist.items.map((i: { id: string; track: { id: string } }) => ({
        id: i.id,
        trackId: i.track.id,
      })),
      added,
    ];
    const result = await call(path() + '/items', guest, 'PUT', { version: before.version, items });
    expect(result.statusCode).toBe(200);
    await call(path() + '/items', owner, 'PUT', {
      version: result.json().version,
      items: [...items].reverse(),
    });
    const detail = (
      await app.inject({
        url: `/api/music/playlists/${playlistId}`,
        cookies: { session_id: guest.cookie },
      })
    ).json().playlist;
    expect(detail.items[0].addedBy).toMatchObject({ id: guest.id });
    expect(detail.items[1].addedBy).toBeNull(); // Never fabricate historical attribution.
    expect(detail.collaboration).toMatchObject({
      isCollaborative: true,
      memberCount: 2,
      role: 'editor',
    });
    const stale = await call(path() + '/items', guest, 'PUT', { version: before.version, items });
    expect(stale.statusCode).toBe(409);
  });
  it('does not emit notifications for a forged self-leave request', async () => {
    const before = await app.prisma.musicStudioChange.count();
    expect((await call(path() + `/members/${stranger.id}`, stranger, 'DELETE')).statusCode).toBe(
      404,
    );
    expect(await app.prisma.musicStudioChange.count()).toBe(before);
  });
  it('exposes only accessible history track labels and refuses restoring removed files', async () => {
    const initial = (await call(path())).json();
    await call(path() + '/items', owner, 'PUT', { version: initial.version, items: [] });
    const history = (await call(path() + '/history')).json();
    const detailsPath = `${path()}/history/${history.entries[0].id}/items`;
    expect((await call(detailsPath)).json().items[0]).toMatchObject({
      kind: 'removed',
      track: { title: 'Track 0' },
    });
    expect((await call(detailsPath, stranger)).statusCode).toBe(404);
    await invite('listener');
    const redacted = (await call(detailsPath, guest)).json();
    expect(redacted.items.every((i: { track: unknown }) => i.track === null)).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain(tracks[0]);
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: tracks[0] } },
      data: { status: 'deleted' },
    });
    const version = (await call(path())).json().version;
    expect(
      (
        await call(`${path()}/history/${history.entries[0].id}/restore`, owner, 'POST', {
          operationId: randomUUID(),
          version,
        })
      ).statusCode,
    ).toBe(403);
    expect(await app.prisma.musicPlaylistItem.count({ where: { playlistId } })).toBe(0);
  });
  it('loads only owned family labels and redacts unavailable recordings', async () => {
    const id = randomUUID();
    await call('/profile', owner, 'PUT', {
      revision: 0,
      families: [
        { id, name: 'Versions', trackIds: tracks.slice(0, 2), preferredTrackId: tracks[0] },
      ],
      sessions: [],
    });
    expect((await call(`/families/${id}/tracks`)).json().tracks).toHaveLength(2);
    expect((await call(`/families/${id}/tracks`, stranger)).statusCode).toBe(404);
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: tracks[0] } },
      data: { status: 'deleted' },
    });
    expect((await call(`/families/${id}/tracks`)).json().tracks).toHaveLength(1);
  });
  it('returns owner-scoped quality and jobs without lyrics or filesystem paths', async () => {
    const health = await call('/health');
    expect(health.statusCode).toBe(200);
    expect(health.json().quality).toMatchObject({
      total: 15,
      unknownLanguage: 0,
      missingYear: 0,
      lyricsMissing: 15,
    });
    expect(health.json().workers).toBeNull();
    expect(health.body).not.toContain('/tmp');
    expect((await call('/health', stranger)).json().quality.total).toBe(0);
    await app.prisma.musicLyrics.createMany({
      data: [null, '', 'fixture searchable lyrics'].map((searchText, index) => ({
        trackId: tracks[index]!,
        content: 'fixture',
        sourceName: 'fixture',
        searchText,
      })),
    });
    expect((await call('/health')).json().quality).toMatchObject({
      lyricsAvailable: 3,
      lyricsIndexed: 1,
      indexPending: 1,
      lyricsMissing: 12,
    });
  });
  it('hydrates a saved session in occurrence order and rejects unavailable tracks', async () => {
    const id = randomUUID();
    await call('/profile', owner, 'PUT', {
      revision: 0,
      families: [],
      sessions: [
        {
          id,
          name: 'Night',
          trackIds: [tracks[0], tracks[0], tracks[1]],
          index: 1,
          position: 42,
          savedAt: new Date().toISOString(),
        },
      ],
    });
    const response = await call(`/sessions/${id}/tracks`);
    expect(response.statusCode).toBe(200);
    expect(response.json().tracks.map((t: { id: string }) => t.id)).toEqual([
      tracks[0],
      tracks[0],
      tracks[1],
    ]);
    expect(response.json()).toMatchObject({ index: 1, position: 42 });
    expect((await call(`/sessions/${id}/tracks`, stranger)).statusCode).toBe(404);
    await app.prisma.driveFile.updateMany({
      where: { musicTrack: { id: tracks[0] } },
      data: { status: 'deleted' },
    });
    expect((await call(`/sessions/${id}/tracks`)).statusCode).toBe(409);
  });
  it('creates once per operation, rejects changed payload and isolates operation IDs by account', async () => {
    const input = { operationId: randomUUID(), name: 'Once' };
    const responses = await Promise.all([
      call('/playlists', owner, 'POST', input),
      call('/playlists', owner, 'POST', input),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(
      await app.prisma.musicPlaylist.count({ where: { userId: owner.id, name: 'Once' } }),
    ).toBe(1);
    expect((await call('/playlists', owner, 'POST', { ...input, name: 'Other' })).statusCode).toBe(
      409,
    );
    expect((await call('/playlists', guest, 'POST', input)).json().playlist.id).not.toBe(
      responses[0]!.json().playlist.id,
    );
  });
  it('replays acknowledged edits without extra history, preserves row timestamps and restores safely', async () => {
    const initial = (await call(path())).json();
    const before = await app.prisma.musicPlaylistItem.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
    });
    const input = {
      operationId: randomUUID(),
      version: initial.version,
      items: before
        .slice(1)
        .reverse()
        .map(({ id, trackId }) => ({ id, trackId })),
    };
    const first = await call(path() + '/items', owner, 'PUT', input);
    expect(first.statusCode).toBe(200);
    expect((await call(path() + '/items', owner, 'PUT', input)).json()).toEqual(first.json());
    const after = await app.prisma.musicPlaylistItem.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
    });
    expect(after.map((i) => i.id)).toEqual(input.items.map((i) => i.id));
    expect(after[0]!.createdAt).toEqual(before[2]!.createdAt);
    const history = (await call(path() + '/history')).json();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ removed: 1, added: 0, canRestore: true });
    expect((await call(path() + '/history', stranger)).statusCode).toBe(404);
    const restorePath = `${path()}/history/${history.entries[0].id}/restore`;
    expect(
      (
        await call(restorePath, owner, 'POST', {
          operationId: randomUUID(),
          version: initial.version,
        })
      ).statusCode,
    ).toBe(409);
    const restored = await call(restorePath, owner, 'POST', {
      operationId: randomUUID(),
      version: first.json().version,
    });
    expect(restored.statusCode).toBe(200);
    expect((await call(path())).json().playlist.items.map((i: { id: string }) => i.id)).toEqual(
      before.map((i) => i.id),
    );
    expect((await call(path() + '/history')).json().entries).toHaveLength(2);
  });
  it('paginates directories without duplicates and validates cursors', async () => {
    for (let i = 0; i < 4; i++)
      await call('/playlists', owner, 'POST', { operationId: randomUUID(), name: `Page ${i}` });
    const first = (await call('/playlists?limit=2')).json();
    const second = (await call(`/playlists?limit=2&cursor=${first.nextCursor}`)).json();
    expect(first.playlists).toHaveLength(2);
    expect(second.playlists).toHaveLength(2);
    expect(
      new Set([...first.playlists, ...second.playlists].map((p: { id: string }) => p.id)).size,
    ).toBe(4);
    expect((await call('/playlists?cursor=garbage')).statusCode).toBe(400);
    expect((await call('/playlists?limit=9999')).statusCode).toBe(400);
  });
  it('replays changes after reconnect and emits revocation without leaking other user events', async () => {
    await shareLibrary();
    await invite();
    const cursor = (await call('/changes', guest)).json().cursor;
    const initial = (await call(path(), guest)).json();
    const input = { operationId: randomUUID(), version: initial.version, items: [] };
    expect((await call(path() + '/items', guest, 'PUT', input)).statusCode).toBe(200);
    const changes = (await call(`/changes?cursor=${cursor}`, guest)).json();
    expect(changes.changes).toContainEqual(expect.objectContaining({ playlistId, kind: 'edit' }));
    expect((await call('/changes?cursor=0', stranger)).json().changes).toEqual([]);
    await call(path() + `/members/${guest.id}`, owner, 'DELETE');
    expect((await call(`/changes?cursor=${changes.cursor}`, guest)).json().changes).toContainEqual(
      expect.objectContaining({ kind: 'membership' }),
    );
    expect((await call(path() + '/items', guest, 'PUT', input)).statusCode).toBe(404);
    expect((await call('/changes?cursor=999999999', guest)).json().resetRequired).toBe(true);
    // Zero is a valid baseline for accounts with no earlier events; it must also
    // resnapshot if the retained event window no longer covers that baseline.
    expect((await call('/changes?cursor=0', guest)).json().resetRequired).toBe(true);
  });
  const shareLibrary = () =>
    app.prisma.libraryMembership.create({
      data: { libraryId, userId: guest.id, role: 'listener' },
    });
  async function invite(role: 'editor' | 'listener' = 'editor') {
    expect(
      (await call(path() + '/invite', owner, 'POST', { email: guest.email, role })).statusCode,
    ).toBe(200);
    expect((await call(path() + '/accept', guest, 'POST')).statusCode).toBe(200);
  }
  it('requires auth and accepted membership; a playlist invitation grants no library access', async () => {
    expect((await app.inject('/api/music/studio/playlists')).statusCode).toBe(401);
    expect((await call(path(), stranger)).statusCode).toBe(404);
    await call(path() + '/invite', owner, 'POST', { email: guest.email, role: 'editor' });
    expect((await call(path(), guest)).statusCode).toBe(404);
    expect((await call('/playlists', guest)).json().playlists[0].pending).toBe(true);
    await call(path() + '/accept', guest, 'POST');
    const response = await call(path(), guest);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json().playlist.items).toEqual([]);
    expect(response.json().canEdit).toBe(false);
    expect(response.json().unavailableCount).toBe(3);
    const denied = await call(path() + '/items', guest, 'PUT', {
      version: response.json().version,
      items: [],
    });
    expect(denied.statusCode).toBe(403);
    expect(await app.prisma.musicPlaylistItem.count({ where: { playlistId } })).toBe(3);
  });
  it('lets an editor edit and undo by occurrence; stale writes cannot overwrite another device', async () => {
    await shareLibrary();
    await invite();
    const first = (await call(path(), guest)).json();
    const before = first.playlist.items.map((i: { id: string; track: { id: string } }) => ({
      id: i.id,
      trackId: i.track.id,
    }));
    const edit = await call(path() + '/items', guest, 'PUT', {
      version: first.version,
      items: before.slice(1),
    });
    expect(edit.statusCode).toBe(200);
    expect(
      (await call(path() + '/items', owner, 'PUT', { version: first.version, items: [] }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call(path() + '/items', guest, 'PUT', { version: edit.json().version, items: before }))
        .statusCode,
    ).toBe(200);
    const restored = (await call(path())).json();
    expect(restored.playlist.items.map((i: { id: string }) => i.id)).toEqual(
      before.map((i: { id: string }) => i.id),
    );
    expect(
      (await call(path() + '/invite', guest, 'POST', { email: stranger.email, role: 'editor' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/music/playlists/${playlistId}`,
          cookies: { session_id: guest.cookie },
        })
      ).statusCode,
    ).toBe(404);
    await call(path() + `/members/${guest.id}`, owner, 'DELETE');
    expect((await call(path(), guest)).statusCode).toBe(404);
  });
  it('keeps listeners read-only and accepts decline/leave without touching other users', async () => {
    await shareLibrary();
    await invite('listener');
    const snapshot = (await call(path(), guest)).json();
    expect(snapshot.canEdit).toBe(false);
    expect(
      (await call(path() + '/items', guest, 'PUT', { version: snapshot.version, items: [] }))
        .statusCode,
    ).toBe(403);
    expect((await call(path() + `/members/${guest.id}`, stranger, 'DELETE')).statusCode).toBe(404);
    expect((await call(path() + `/members/${guest.id}`, guest, 'DELETE')).statusCode).toBe(200);
    expect((await call(path(), guest)).statusCode).toBe(404);
  });
  it('moves selected occurrences atomically, with target concurrency validation', async () => {
    const target = await app.prisma.musicPlaylist.create({
      data: { userId: owner.id, name: 'Target' },
    });
    const source = (await call(path())).json();
    const targetState = (await call(`/playlists/${target.id}`)).json();
    const body = {
      operationId: randomUUID(),
      version: source.version,
      targetId: target.id,
      targetVersion: targetState.version,
      itemIds: [source.playlist.items[2].id],
      move: true,
    };
    expect(
      (await call(path() + '/transfer', owner, 'POST', { ...body, targetVersion: '0'.repeat(64) }))
        .statusCode,
    ).toBe(409);
    expect(await app.prisma.musicPlaylistItem.count({ where: { playlistId } })).toBe(3);
    expect((await call(path() + '/transfer', owner, 'POST', body)).statusCode).toBe(200);
    expect((await call(path() + '/transfer', owner, 'POST', body)).statusCode).toBe(200);
    expect(
      await app.prisma.musicPlaylistRevision.count({
        where: { playlistId: { in: [playlistId, target.id] } },
      }),
    ).toBe(2);
    expect(await app.prisma.musicPlaylistItem.count({ where: { playlistId } })).toBe(2);
    const moved = await app.prisma.musicPlaylistItem.findMany({ where: { playlistId: target.id } });
    expect(moved.map((i) => i.trackId)).toEqual([tracks[0]]);
    expect(moved[0]!.id).not.toBe(body.itemIds[0]);
  });
  it('prevents foreign tracks, invalid occurrences and oversized edits', async () => {
    const snapshot = (await call(path())).json();
    expect(
      (
        await call(path() + '/items', owner, 'PUT', {
          version: snapshot.version,
          items: [{ id: randomUUID(), trackId: 'private' }],
        })
      ).statusCode,
    ).toBe(403);
    const foreign = await app.prisma.musicPlaylist.create({
      data: {
        userId: stranger.id,
        name: 'Private',
        items: { create: { trackId: tracks[0]!, position: 0 } },
      },
      include: { items: true },
    });
    expect(
      (
        await call(path() + '/items', owner, 'PUT', {
          version: snapshot.version,
          items: [{ id: foreign.items[0]!.id, trackId: tracks[0] }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(path() + '/items', owner, 'PUT', {
          version: snapshot.version,
          items: Array.from({ length: 2001 }, () => ({ id: randomUUID(), trackId: tracks[0] })),
        })
      ).statusCode,
    ).toBe(400);
  });
  it('persists per-user families and queue positions with CAS and access checks', async () => {
    const value = {
      ...emptyStudio(),
      families: [
        {
          id: randomUUID(),
          name: 'Work',
          trackIds: tracks.slice(0, 2),
          preferredTrackId: tracks[1],
        },
      ],
      sessions: [
        {
          id: randomUUID(),
          name: 'Night',
          trackIds: [tracks[0], tracks[0], tracks[1]],
          index: 1,
          position: 32,
          savedAt: new Date().toISOString(),
        },
      ],
    };
    expect((await call('/profile', owner, 'PUT', value)).statusCode).toBe(200);
    expect((await call('/profile', owner, 'PUT', value)).statusCode).toBe(409);
    expect((await call('/profile')).json().sessions[0].position).toBe(32);
    expect((await call('/profile', guest)).json().sessions).toEqual([]);
    expect((await call('/profile', guest, 'PUT', value)).statusCode).toBe(403);
  });
  it('accepts only one competing edit and treats unknown member roles as read-only', async () => {
    await shareLibrary();
    await invite();
    const snapshot = (await call(path())).json();
    const items = snapshot.playlist.items.map((item: { id: string; track: { id: string } }) => ({
      id: item.id,
      trackId: item.track.id,
    }));
    const results = await Promise.all([
      call(path() + '/items', owner, 'PUT', { version: snapshot.version, items: items.slice(1) }),
      call(path() + '/items', guest, 'PUT', {
        version: snapshot.version,
        items: items.slice(0, 1),
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    await app.prisma.musicPlaylistMembership.update({
      where: { playlistId_userId: { playlistId, userId: guest.id } },
      data: { role: 'unrecognized' },
    });
    const current = (await call(path(), guest)).json();
    expect(current.role).toBe('listener');
    expect(
      (await call(path() + '/items', guest, 'PUT', { version: current.version, items: [] }))
        .statusCode,
    ).toBe(403);
  });
  it('ignores malformed optional studio content without breaking Discovery', async () => {
    await app.prisma.musicStudio.create({
      data: { userId: owner.id, revision: 5, content: '{broken' },
    });
    expect((await call('/profile')).json()).toEqual({ ...emptyStudio(), revision: 5 });
    const response = await app.inject({
      url: '/api/music/discovery',
      cookies: { session_id: owner.cookie },
    });
    expect(response.statusCode).toBe(200);
  });
  it('refines locally, retaining tracks and hard years without invoking the provider again', async () => {
    const intent: PlaylistIntentProviderOutput = {
      title: '2000s',
      subtitle: 'Pop',
      targetCount: 10,
      genres: [{ name: 'pop', mode: 'hard', weight: 1 }],
      excludedGenres: [],
      artists: [],
      excludedArtistNames: [],
      year: { min: 2000, max: 2009, weight: 1, mode: 'hard' },
      language: { languages: ['tr'], excludedLanguages: [], weight: 1, mode: 'hard' },
      locale: { countries: [], scenes: [], weight: 0, mode: 'soft' },
      exploration: 0.5,
      familiarity: 0.5,
      favoriteBias: 0,
      unheardBias: 0,
      lowPlayCountBias: 0,
      oldLibraryBias: 0,
      recentPlayPenalty: 0,
      artistDiversity: 0.5,
      albumDiversity: 0.5,
      seedMode: 'balanced',
    };
    const provider = { generatePlaylistIntent: vi.fn(async () => intent) };
    const service = new MusicAiPlaylistService(app.prisma, provider);
    const initial = await service.generate(owner.id, '2000ler türkçe pop', 'first');
    expect(initial.mix.tracks.length).toBe(10);
    const keep = initial.mix.tracks.slice(0, 2).map((t) => t.id);
    const refined = await service.refine(owner.id, initial.mix.id, keep, 'next');
    expect(refined.mix.tracks.slice(0, 2).map((t) => t.id)).toEqual(keep);
    expect(refined.mix.tracks).toHaveLength(6);
    expect(refined.mix.tracks.every((t) => t.year === 2005)).toBe(true);
    expect(
      refined.mix.tracks.slice(2).some((t) => initial.mix.tracks.some((old) => old.id === t.id)),
    ).toBe(false);
    expect(provider.generatePlaylistIntent).toHaveBeenCalledTimes(1);
    const again = await service.refine(owner.id, initial.mix.id, keep, 'next');
    expect(again.mix.tracks.map((t) => t.id)).toEqual(refined.mix.tracks.map((t) => t.id));
    await expect(service.refine(guest.id, initial.mix.id, keep, 'next')).rejects.toMatchObject({
      statusCode: 410,
    });
    await expect(
      service.refine(owner.id, initial.mix.id, ['unavailable'], 'next'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

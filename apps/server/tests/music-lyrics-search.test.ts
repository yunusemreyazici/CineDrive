import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';
import { MusicLyricsService } from '../src/services/music-lyrics.service';
import { backfillLyricsSearch } from '../src/services/music-lyrics-search.service';
import {
  lyricsExcerpt,
  lyricsSearchExpression,
  normalizeLyricsSearch,
} from '../src/utils/music-lyrics-search';

describe('lyrics search literals', () => {
  it('folds Turkish characters and accents without losing non-Latin scripts', () => {
    expect(normalizeLyricsSearch('IŞIK İÇİN, gönlüm ŞİMDİ déjà!')).toBe(
      'isik icin gonlum simdi deja',
    );
    expect(normalizeLyricsSearch('日本語')).toBe('日本語');
    expect(lyricsSearchExpression('"gönlüm" OR * NEAR(gece)')).toBe(
      '"gonlum"* AND "or"* AND "near"* AND "gece"*',
    );
    expect(lyricsSearchExpression('a')).toBeNull();
    expect(lyricsSearchExpression('* "')).toBeNull();
    expect(lyricsSearchExpression('a'.repeat(201))).toBeNull();
    expect(
      lyricsSearchExpression(Array.from({ length: 13 }, (_, i) => `word${i}`).join(' ')),
    ).toBeNull();
  });
  it('bounds an excerpt while keeping a late matching word visible', () => {
    const excerpt = lyricsExcerpt(
      ['unrelated', `${'x'.repeat(400)} gözlerin geceyi aydınlatır ${'y'.repeat(400)}`],
      'gözlerin',
    );
    expect(Array.from(excerpt).length).toBeLessThanOrEqual(182);
    expect(excerpt).toContain('gözlerin');
  });
});

describe('local indexed lyrics search', () => {
  let app: FastifyInstance;
  let userId: string;
  let cookie: string;
  let libraryId: string;
  let otherUserId: string;
  let otherLibraryId: string;
  const fetch = () =>
    vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected external provider request'));
  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    cookie = login.cookies.find((entry) => entry.name === 'session_id')!.value;
    userId = (await app.authService.ensureAdminUserExists()).id;
    const other = await app.prisma.user.create({
      data: {
        email: `${randomUUID()}@test.invalid`,
        name: 'Lyrics fixture',
        passwordHash: 'unused',
        role: 'user',
      },
    });
    otherUserId = other.id;
    libraryId = (
      await app.prisma.library.create({
        data: { userId, name: 'lyrics owned', storageType: 'local', rootFolderId: '' },
      })
    ).id;
    otherLibraryId = (
      await app.prisma.library.create({
        data: { userId: other.id, name: 'lyrics private', storageType: 'local', rootFolderId: '' },
      })
    ).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.prisma.library.deleteMany({ where: { id: { in: [libraryId, otherLibraryId] } } });
    await app.prisma.user.delete({ where: { id: otherUserId } });
    await app.close();
  });
  const search = (query: string) =>
    app.inject({
      method: 'GET',
      url: `/api/music/search?q=${encodeURIComponent(query)}`,
      cookies: { session_id: cookie },
    });
  const createTrack = async (library: string, title = 'Different title') => {
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId: library,
        name: `${randomUUID()}.mp3`,
        storageType: 'local',
        mimeType: 'audio/mpeg',
        status: 'active',
      },
    });
    return app.prisma.musicTrack.create({
      data: {
        libraryId: library,
        driveFileId: file.id,
        title,
        normalizedTitle: title.toLowerCase(),
      },
    });
  };
  const save = (trackId: string, content: string) =>
    new MusicLyricsService(app.prisma).syncTrackLyrics({
      trackId,
      content,
      sourceName: 'fixture.lrc',
    });

  it('finds accentless verses, strips LRC markers, stays additive and never calls a provider', async () => {
    const http = fetch();
    const track = await createTrack(libraryId);
    const content =
      '[ar:Hidden Marker]\n[offset:200]\n[00:12.00]<00:12.01>Gözlerin <00:12.50>geceyi aydınlatır\n[00:20.00]IŞIK İÇİN';
    await save(track.id, content);
    const response = await search('gozlerin geceyi');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tracks: [],
      albums: [],
      artists: [],
      lyricsMatches: [{ track: { id: track.id }, excerpt: 'Gözlerin geceyi aydınlatır' }],
    });
    expect((await search('isik icin')).json().lyricsMatches[0].track.id).toBe(track.id);
    expect((await search('Hidden Marker')).json().lyricsMatches).toEqual([]);
    expect((await search('00:12')).json().lyricsMatches).toEqual([]);
    expect(
      (await app.prisma.musicLyrics.findUniqueOrThrow({ where: { trackId: track.id } })).content,
    ).toBe(content);
    expect(
      (await app.inject({ method: 'GET', url: '/api/music/search?q=gozlerin' })).statusCode,
    ).toBe(401);
    expect((await search('" OR * NEAR(')).statusCode).toBe(200);
    expect(http).not.toHaveBeenCalled();
  });

  it('filters permissions before the limit and supports owner/editor/listener but not revoked/inactive tracks', async () => {
    const http = fetch();
    for (let i = 0; i < 10; i += 1)
      await save((await createTrack(otherLibraryId)).id, 'gözlerin geceyi aydınlatır');
    const owned = await createTrack(libraryId);
    await save(owned.id, 'gözlerin geceyi aydınlatır');
    expect(
      (await search('gozlerin'))
        .json()
        .lyricsMatches.map((match: { track: { id: string } }) => match.track.id),
    ).toEqual([owned.id]);
    for (const role of ['listener', 'editor', 'owner']) {
      await app.prisma.libraryMembership.upsert({
        where: { libraryId_userId: { libraryId: otherLibraryId, userId } },
        create: { libraryId: otherLibraryId, userId, role },
        update: { role },
      });
      expect((await search('gozlerin')).json().lyricsMatches).toHaveLength(8);
    }
    await app.prisma.libraryMembership.deleteMany({ where: { libraryId: otherLibraryId, userId } });
    expect((await search('gozlerin')).json().lyricsMatches).toHaveLength(1);
    await app.prisma.driveFile.update({
      where: { id: owned.driveFileId },
      data: { status: 'archived' },
    });
    expect((await search('gozlerin')).json().lyricsMatches).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it('updates the index on edits/revision application and deletes it with the track', async () => {
    fetch();
    const track = await createTrack(libraryId);
    const lyrics = await save(track.id, 'ilk dize burada');
    await save(track.id, 'yeni dize burada');
    expect((await search('ilk dize')).json().lyricsMatches).toEqual([]);
    expect((await search('yeni dize')).json().lyricsMatches).toHaveLength(1);
    const revision = await app.prisma.musicLyricsRevision.create({
      data: {
        lyricsId: lyrics.id,
        content: '[00:01]Revizyon dizesi burada',
        sourceName: 'revision.lrc',
      },
    });
    await new MusicLyricsService(app.prisma).applyRevision(track.id, revision.id);
    expect((await search('yeni dize')).json().lyricsMatches).toEqual([]);
    expect((await search('revizyon dizesi')).json().lyricsMatches).toHaveLength(1);
    await app.prisma.musicTrack.delete({ where: { id: track.id } });
    expect((await search('revizyon')).json().lyricsMatches).toEqual([]);
  });

  it('ranks the complete phrase before scattered words and supports literal typeahead prefixes', async () => {
    const http = fetch();
    const scattered = await createTrack(libraryId);
    const exact = await createTrack(libraryId);
    await save(scattered.id, 'gözlerin uzaklarda başka bir geceyi aydınlatır');
    await save(exact.id, 'gözlerin geceyi aydınlatır');
    expect(
      (await search('gozlerin geceyi'))
        .json()
        .lyricsMatches.map((match: { track: { id: string } }) => match.track.id),
    ).toEqual([exact.id, scattered.id]);
    expect((await search('gozler gec')).json().lyricsMatches).toHaveLength(2);
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects an index hit if the lyrics change before excerpt hydration', async () => {
    const http = fetch();
    const track = await createTrack(libraryId);
    const lyrics = await save(track.id, 'gözlerin geceyi aydınlatır');
    // MATCH still reads the old indexed verse; hydrate a replacement snapshot
    // to deterministically model the intervening edit without timing sleeps.
    vi.spyOn(app.prisma.musicLyrics, 'findMany').mockResolvedValue([
      { ...lyrics, content: 'tamamen farklı bir dize', searchText: 'tamamen farkli bir dize' },
    ]);
    expect((await search('gozlerin')).json().lyricsMatches).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it('backfills old plain/synchronized lyrics once in bounded batches without touching originals', async () => {
    const http = fetch();
    const find = vi.spyOn(app.prisma.musicLyrics, 'findMany');
    const content = '[ar:ignore]\n[00:01]Eski sözlerin ışığı';
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const track = await createTrack(libraryId);
      ids.push(track.id);
      await app.prisma.musicLyrics.create({
        data: { trackId: track.id, content, sourceName: 'old.lrc' },
      });
    }
    expect((await search('eski sozlerin')).json().lyricsMatches).toEqual([]);
    await backfillLyricsSearch(app.prisma);
    expect(
      find.mock.calls
        .filter(([arg]) => arg?.where?.searchText === null)
        .every(([arg]) => arg?.take === 10),
    ).toBe(true);
    expect((await search('eski sozlerin')).json().lyricsMatches).toHaveLength(8);
    expect(
      await app.prisma.musicLyrics.count({
        where: { trackId: { in: ids }, content, searchText: 'eski sozlerin isigi' },
      }),
    ).toBe(12);
    const update = vi.spyOn(app.prisma, '$transaction');
    await backfillLyricsSearch(app.prisma);
    expect(update).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });
});

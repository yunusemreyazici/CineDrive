import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  defaultMusicPersonalization,
  musicPersonalizationSchema,
  musicSmartRuleSchema,
} from '@cinedrive/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  matchesSmartRule,
  personalizationSignals,
  meaningfulLastPlays,
  parseMusicPersonalization,
} from '../src/services/music-personalization.service.js';
import type { DiscoveryCandidate } from '../src/services/music-discovery-candidates.js';

const rule = () =>
  musicSmartRuleSchema.parse({
    id: randomUUID(),
    name: 'Unheard',
    favoritesOnly: false,
    unheardOnly: true,
    genre: '',
    language: '',
    downloadedOnly: false,
    limit: 50,
  });
const candidate = (
  id: string,
  overrides: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate => ({
  id,
  title: id,
  discNumber: 1,
  trackNumber: 1,
  artistId: 'artist',
  artistName: 'Artist',
  artistArtworkUrl: null,
  albumId: 'album',
  albumTitle: 'Album',
  albumYear: 2005,
  genres: ['Rock'],
  albumGenres: [],
  year: 2005,
  duration: 120,
  playCount: 0,
  isFavorite: true,
  languageCode: 'tr',
  languageSource: 'lyrics',
  languageConfidence: 0.95,
  createdAt: new Date('2026-10-01'),
  updatedAt: new Date('2026-10-01'),
  ...overrides,
});

describe('music personalization rules', () => {
  it('bounds inputs, forbids arbitrary filters and supports native omitted null fields', () => {
    expect(rule().notPlayedDays).toBeNull();
    expect(parseMusicPersonalization('{}')).toEqual(defaultMusicPersonalization());
    expect(
      musicPersonalizationSchema.safeParse({ ...defaultMusicPersonalization(), sql: 'select *' })
        .success,
    ).toBe(false);
    expect(
      musicPersonalizationSchema.safeParse({
        ...defaultMusicPersonalization(),
        preferences: { exploration: 2, artistDiversity: 0.5, recentPlayPenalty: 0.5 },
      }).success,
    ).toBe(false);
    const duplicate = rule();
    expect(
      musicPersonalizationSchema.safeParse({
        ...defaultMusicPersonalization(),
        smartLists: [duplicate, duplicate],
      }).success,
    ).toBe(false);
  });
  it('intersects all smart conditions without weakening language or history', () => {
    const now = Date.parse('2026-10-15');
    const conditions = {
      ...rule(),
      favoritesOnly: true,
      language: 'tr' as const,
      genre: 'ROCK',
      addedWithinDays: 30,
    };
    expect(matchesSmartRule(candidate('a'), conditions, undefined, now)).toBe(true);
    for (const change of [
      { languageCode: null },
      { languageConfidence: 0.2 },
      { genres: ['pop'] },
      { isFavorite: false },
      { createdAt: new Date('2020-01-01') },
    ]) {
      expect(matchesSmartRule(candidate('a', change), conditions, undefined, now)).toBe(false);
    }
    expect(matchesSmartRule(candidate('a'), conditions, now - 90 * 86_400_000, now)).toBe(false);
    const forgotten = { ...conditions, unheardOnly: false, notPlayedDays: 30 };
    expect(matchesSmartRule(candidate('a'), forgotten, now - 31 * 86_400_000, now)).toBe(true);
    expect(matchesSmartRule(candidate('a'), forgotten, now - 5 * 86_400_000, now)).toBe(false);
  });
  it('hides tracks, expires artist snoozes and boosts affinity without changing favorites', () => {
    const tracks = [candidate('a'), candidate('b'), candidate('c', { artistId: 'other' })];
    const profile = defaultMusicPersonalization();
    profile.feedback = [
      { trackId: 'a', kind: 'snoozeArtist', expiresAt: '2026-10-16T00:00:00Z' },
      { trackId: 'c', kind: 'hide', expiresAt: null },
    ];
    const signals = personalizationSignals(tracks, profile, Date.parse('2026-10-15'));
    expect(tracks.filter(signals.allowed)).toEqual([]);
    expect(
      tracks
        .filter(personalizationSignals(tracks, profile, Date.parse('2026-10-17')).allowed)
        .map((t) => t.id),
    ).toEqual(['a', 'b']);
    profile.feedback = [{ trackId: 'a', kind: 'more', expiresAt: null }];
    expect(personalizationSignals(tracks, profile).boost(tracks[1]!)).toBeGreaterThan(0);
    expect(tracks.every((t) => t.isFavorite)).toBe(true);
  });
});

describe('music personalization HTTP', () => {
  let app: FastifyInstance;
  let cookie: string;
  let userId: string;
  let otherId: string;
  let libraryId: string;
  let trackId: string;
  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    const user = await app.authService.ensureAdminUserExists();
    userId = user.id;
    await app.prisma.user.update({ where: { id: userId }, data: { musicPersonalization: '{}' } });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    cookie = login.cookies.find((c) => c.name === 'session_id')!.value;
    const other = await app.authService.createUser({
      email: `personal-${randomUUID()}@example.test`,
      name: 'Other',
      password: 'test-password-long',
      role: 'user',
    });
    otherId = other.id;
    const library = await app.prisma.library.create({
      data: {
        userId,
        name: 'Personalization',
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: '/tmp',
      },
    });
    libraryId = library.id;
    const file = await app.prisma.driveFile.create({
      data: {
        libraryId,
        name: 'fixture.mp3',
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
        title: 'Fixture',
        normalizedTitle: 'fixture',
        duration: 120,
        genres: '["Rock"]',
        languageCode: 'tr',
        languageConfidence: 0.95,
      },
    });
    trackId = track.id;
  });
  afterEach(async () => {
    await app.prisma.library.deleteMany({ where: { id: libraryId } });
    await app.prisma.user.deleteMany({ where: { id: otherId } });
    await app.prisma.user.update({ where: { id: userId }, data: { musicPersonalization: '{}' } });
    await app.close();
  });
  const get = (path = '') =>
    app.inject({ url: `/api/music/personalization${path}`, cookies: { session_id: cookie } });
  const put = (payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/api/music/personalization',
      cookies: { session_id: cookie },
      payload: payload as object,
    });

  it('requires authentication, keeps defaults private, rejects stale writes and foreign feedback', async () => {
    expect((await app.inject('/api/music/personalization')).statusCode).toBe(401);
    const initial = await get();
    expect(initial.statusCode).toBe(200);
    expect(initial.headers['cache-control']).toContain('no-store');
    expect(initial.json()).toEqual(defaultMusicPersonalization());
    expect((await put(initial.json())).statusCode).toBe(200);
    expect((await put(initial.json())).statusCode).toBe(409);
    const latest = (await get()).json();
    expect(
      (await put({ ...latest, feedback: [{ trackId: 'unavailable', kind: 'hide' }] })).statusCode,
    ).toBe(400);
    expect(
      (await app.prisma.user.findUniqueOrThrow({ where: { id: otherId } })).musicPersonalization,
    ).toBe('{}');
    expect((await get(`/smart/${randomUUID()}`)).statusCode).toBe(404);
  });
  it('evaluates saved rules against meaningful history, not short skips, and excludes inaccessible tracks', async () => {
    const smart = rule();
    expect((await put({ ...defaultMusicPersonalization(), smartLists: [smart] })).statusCode).toBe(
      200,
    );
    await app.prisma.musicHistory.create({
      data: { userId, trackId, listenedSeconds: 2, playedAt: new Date('2026-10-10') },
    });
    expect((await get(`/smart/${smart.id}`)).json().trackIds).toContain(trackId);
    const played = new Date('2026-10-11T12:00:00Z');
    await app.prisma.musicHistory.create({
      data: { userId, trackId, listenedSeconds: 45, playedAt: played },
    });
    expect((await meaningfulLastPlays(app.prisma, userId)).get(trackId)).toBe(played.getTime());
    expect((await get(`/smart/${smart.id}`)).json().trackIds).not.toContain(trackId);
    await app.prisma.library.update({ where: { id: libraryId }, data: { userId: otherId } });
    expect(
      (
        await put({
          ...musicPersonalizationSchema.parse((await get()).json()),
          feedback: [{ trackId, kind: 'hide' }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await get(`/smart/${smart.id}`)).json().trackIds).not.toContain(trackId);
  });
  it('invalidates discovery on feedback revision and never fills hidden tracks back in', async () => {
    const request = () =>
      app.inject({
        url: '/api/music/discovery?generationId=personal-regression',
        cookies: { session_id: cookie },
      });
    const before = await request();
    expect(before.statusCode).toBe(200);
    expect(JSON.stringify(before.json().mixes)).toContain(trackId);
    expect(
      (await put({ ...defaultMusicPersonalization(), feedback: [{ trackId, kind: 'hide' }] }))
        .statusCode,
    ).toBe(200);
    const after = await request();
    expect(after.statusCode).toBe(200);
    for (const key of [
      'mixes',
      'libraryDepthCollections',
      'moodCollections',
      'genreCollections',
      'decadeCollections',
    ]) {
      expect(JSON.stringify(after.json()[key])).not.toContain(trackId);
    }
  });
  it('returns the exact evaluated rule so another device cannot cache results under stale criteria', async () => {
    const original = rule();
    const saved = await put({ ...defaultMusicPersonalization(), smartLists: [original] });
    expect(saved.statusCode).toBe(200);
    expect((await get(`/smart/${original.id}`)).json().evaluatedRule).toEqual(original);
    const updated = { ...original, language: 'en' as const, limit: 20 };
    expect(
      (await put({ ...musicPersonalizationSchema.parse(saved.json()), smartLists: [updated] }))
        .statusCode,
    ).toBe(200);
    const result = await get(`/smart/${original.id}`);
    expect(result.json().evaluatedRule).toEqual(updated);
    expect(result.json().trackIds).not.toContain(trackId);
  });
});

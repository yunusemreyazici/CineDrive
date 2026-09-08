import type { PlaylistIntentProviderOutput } from '@cinedrive/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryCandidate } from '../src/services/music-discovery-candidates';
import {
  buildEditorialListenerProfile,
  buildLocalEditorialPlans,
  normalizeEditorialPlans,
  selectEditorialCandidates,
} from '../src/services/music-ai-editorial.service';
import {
  buildMusicAiEditorialPrompt,
  OpenAiCompatibleMusicProvider,
} from '../src/services/music-ai-provider';
import { buildMusicCatalogueSummary } from '../src/services/music-ai-intent';

const intent = (
  title: string,
  overrides: Partial<PlaylistIntentProviderOutput> = {},
): PlaylistIntentProviderOutput => ({
  title,
  subtitle: `${title} subtitle`,
  targetCount: 10,
  genres: [],
  excludedGenres: [],
  artists: [],
  excludedArtistNames: [],
  year: { min: null, max: null, weight: 0, mode: 'soft' },
  language: { languages: [], excludedLanguages: [], weight: 0, mode: 'soft' },
  locale: { countries: [], scenes: [], weight: 0, mode: 'soft' },
  exploration: 0.5,
  familiarity: 0.5,
  favoriteBias: 0.4,
  unheardBias: 0.4,
  lowPlayCountBias: 0.4,
  oldLibraryBias: 0.4,
  recentPlayPenalty: 0.5,
  artistDiversity: 0.9,
  albumDiversity: 0.9,
  seedMode: 'balanced',
  ...overrides,
});

const candidate = (index: number): DiscoveryCandidate => ({
  id: `track-${index}`,
  title: `Private Track ${index}`,
  discNumber: 1,
  trackNumber: index,
  artistId: `artist-${index % 20}`,
  artistName: `Private Artist ${index % 20}`,
  artistArtworkUrl: null,
  albumId: `album-${index % 50}`,
  albumTitle: `Private Album ${index % 50}`,
  albumYear: 1990 + (index % 4) * 10,
  genres: [index % 2 ? 'rock' : 'pop'],
  albumGenres: [],
  year: 1990 + (index % 4) * 10,
  duration: 200,
  playCount: index % 8,
  isFavorite: index % 9 === 0,
  languageCode: index % 3 ? 'tr' : 'en',
  languageSource: 'lyrics',
  languageConfidence: 0.95,
  createdAt: new Date(`2020-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

describe('Music AI editorial planning', () => {
  it('builds a bounded aggregate profile without media identities for a 10k catalogue', () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => candidate(index));
    const profile = buildEditorialListenerProfile(candidates, []);
    const serialized = JSON.stringify(profile);
    expect(profile.totalTrackCount).toBe(10_000);
    expect(profile.genres.length).toBeLessThanOrEqual(16);
    expect(profile.decades.length).toBeLessThanOrEqual(10);
    expect(profile.languages.length).toBeLessThanOrEqual(8);
    expect(serialized).not.toContain('Private Track');
    expect(serialized).not.toContain('Private Artist');
    expect(serialized).not.toContain('Private Album');
  });

  it('sends only catalogue vocabulary and aggregate profile to the provider', async () => {
    const candidates = Array.from({ length: 80 }, (_, index) => candidate(index));
    const catalogue = buildMusicCatalogueSummary(candidates);
    const profile = buildEditorialListenerProfile(candidates, []);
    const plans = {
      plans: [
        { slot: 'daily', intent: intent('Daily') },
        { slot: 'rediscovery', intent: intent('Rediscovery') },
        { slot: 'comfort', intent: intent('Comfort') },
        { slot: 'crossover', intent: intent('Crossover') },
        { slot: 'time-capsule', intent: intent('Time Capsule') },
      ],
    };
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(plans) } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const provider = new OpenAiCompatibleMusicProvider({
      apiKey: 'test-secret',
      model: 'test-model',
      baseUrl: 'https://provider.invalid/v1',
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
    });
    await provider.generateEditorialPlans({
      catalogue,
      profile,
      locale: 'tr',
      editionDate: '2026-09-08',
    });
    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    const body = JSON.stringify(request);
    expect(request.response_format.json_schema.name).toBe('music_editorial_plans');
    expect(request.reasoning_effort).toBe('none');
    expect(request.tools).toBeUndefined();
    expect(body).not.toContain('Private Track');
    expect(body).not.toContain('Private Artist');
    expect(body).not.toContain('Private Album');
    expect(request.messages[0].content).toContain('"totalTrackCount":80');
  });

  it('forces proactive categorical facets soft and removes artists and exclusions', () => {
    const candidates = Array.from({ length: 80 }, (_, index) => candidate(index));
    const catalogue = buildMusicCatalogueSummary(candidates);
    const profile = buildEditorialListenerProfile(candidates, []);
    const fallback = buildLocalEditorialPlans('tr', catalogue, profile);
    const output = {
      plans: [
        {
          slot: 'daily',
          intent: intent('Risky', {
            genres: [{ name: 'rock', weight: 5, mode: 'hard' }],
            excludedGenres: ['pop'],
            artists: [{ name: 'Private Artist', weight: 1, mode: 'hard' }],
            excludedArtistNames: ['Other Artist'],
            year: { min: 2000, max: 2009, weight: 2, mode: 'hard' },
            language: { languages: ['tr'], excludedLanguages: ['en'], weight: 2, mode: 'hard' },
          }),
        },
        { slot: 'rediscovery', intent: intent('Rediscovery') },
        { slot: 'comfort', intent: intent('Comfort') },
      ],
    };
    const normalized = normalizeEditorialPlans(output, catalogue, fallback);
    const daily = normalized.find((plan) => plan.slot === 'daily')!.intent;
    expect(daily.genres[0]).toMatchObject({ name: 'rock', weight: 1, mode: 'soft' });
    expect(daily.year.mode).toBe('soft');
    expect(daily.language.mode).toBe('soft');
    expect(daily.artists).toEqual([]);
    expect(daily.excludedGenres).toEqual([]);
    expect(daily.excludedArtistNames).toEqual([]);
    expect(daily.language.excludedLanguages).toEqual([]);
  });

  it('keeps a daily edition deterministic and reduces cross-playlist repetition', () => {
    const candidates = Array.from({ length: 160 }, (_, index) => candidate(index));
    const catalogue = buildMusicCatalogueSummary(candidates);
    const profile = buildEditorialListenerProfile(candidates, []);
    const plans = buildLocalEditorialPlans('tr', catalogue, profile);
    const first = selectEditorialCandidates(candidates, [], plans, 'editorial-2026-09-08');
    const repeated = selectEditorialCandidates(candidates, [], plans, 'editorial-2026-09-08');
    expect(first.map((item) => item.candidates.map((track) => track.id))).toEqual(
      repeated.map((item) => item.candidates.map((track) => track.id)),
    );
    const firstTwo = first.slice(0, 2).flatMap((item) => item.candidates.map((track) => track.id));
    expect(new Set(firstTwo).size).toBe(firstTwo.length);
  });

  it('documents the no-song editorial contract in the prompt', () => {
    const prompt = buildMusicAiEditorialPrompt({
      catalogue: { totalTrackCount: 0, availableGenres: [], yearRange: null, decades: [] },
      profile: {
        totalTrackCount: 0,
        favoriteTrackCount: 0,
        playedTrackCount: 0,
        unheardTrackCount: 0,
        underplayedTrackCount: 0,
        meaningfulHistoryCount: 0,
        genres: [],
        decades: [],
        languages: [],
      },
      locale: 'en',
      editionDate: '2026-09-08',
    });
    expect(prompt).toContain('Never name or select songs');
    expect(prompt).toContain('artists and excludedArtistNames must always be empty');
    expect(prompt).toContain('must be SOFT');
  });
});

import type { EnvConfig, PlaylistIntentProviderOutput } from '@cinedrive/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryCandidate } from '../src/services/music-discovery-candidates';
import {
  buildMusicCatalogueSummary,
  groundGenreName,
  MusicAiIntentPlanner,
  normalizePlaylistIntent,
} from '../src/services/music-ai-intent';
import {
  buildMusicAiPlannerPrompt,
  createMusicAiProvider,
  MusicAiProviderError,
  OpenAiCompatibleMusicProvider,
} from '../src/services/music-ai-provider';
import {
  type AiPlaylistHistoryEntry,
  describeHardIntentConstraints,
  explainCandidateIntent,
  selectAiPlaylistCandidates,
} from '../src/services/music-ai-playlist.service';

const rawIntent = (
  overrides: Partial<PlaylistIntentProviderOutput> = {},
): PlaylistIntentProviderOutput => ({
  title: 'Night Drive',
  subtitle: 'A local selection',
  targetCount: 50,
  genres: [],
  excludedGenres: [],
  artists: [],
  excludedArtistNames: [],
  year: { min: null, max: null, weight: 0, mode: 'soft' },
  language: { languages: [], excludedLanguages: [], weight: 0, mode: 'soft' },
  locale: { countries: [], scenes: [], weight: 0, mode: 'soft' },
  exploration: 0.5,
  familiarity: 0.5,
  favoriteBias: 0.3,
  unheardBias: 0.3,
  lowPlayCountBias: 0.3,
  oldLibraryBias: 0.3,
  recentPlayPenalty: 0.5,
  artistDiversity: 0.8,
  albumDiversity: 0.8,
  seedMode: 'balanced',
  ...overrides,
});

const catalogue = {
  totalTrackCount: 10_000,
  availableGenres: [
    { name: 'rock', count: 4_000 },
    { name: 'alternative rock', count: 2_000 },
    { name: 'turkce rock', count: 75 },
    { name: 'pop', count: 3_000 },
    { name: 'rap', count: 800 },
  ],
  yearRange: { min: 1965, max: 2026 },
  decades: [{ decade: 1990, count: 2_000 }],
};

const provider = (fetchImpl: typeof fetch, timeoutMs = 10_000) =>
  new OpenAiCompatibleMusicProvider({
    apiKey: 'test-secret',
    model: 'qwen/qwen3.8-27b',
    baseUrl: 'https://provider.invalid/openai/v1',
    timeoutMs,
    fetchImpl,
  });

describe('Music AI provider', () => {
  it('parses a valid structured response without sending catalogue track metadata', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(rawIntent()) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const result = await provider(fetchImpl as typeof fetch).generatePlaylistIntent({
      prompt: 'Gece sürüşü',
      catalogue,
    });
    expect(result).toEqual(rawIntent());
    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
    expect(request.reasoning_effort).toBe('none');
    expect(request.tools).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain('Track 9999');
    expect(JSON.stringify(request)).not.toContain('Album 999');
    expect(JSON.stringify(request)).not.toContain('Artist 999');
    expect(request.messages[0].content).toContain('"totalTrackCount":10000');
  });

  it.each([
    [429, 'rate-limited'],
    [500, 'upstream'],
    [503, 'upstream'],
  ] as const)('maps HTTP %s to %s', async (status, failure) => {
    const action = provider(
      vi.fn(async () => new Response('', { status })) as typeof fetch,
    ).generatePlaylistIntent({ prompt: 'rock', catalogue });
    await expect(action).rejects.toMatchObject({ failure });
  });

  it('rejects malformed provider payloads', async () => {
    const action = provider(
      vi.fn(async () => new Response('{oops', { status: 200 })) as typeof fetch,
    ).generatePlaylistIntent({ prompt: 'rock', catalogue });
    await expect(action).rejects.toMatchObject({ failure: 'malformed-response' });
  });

  it('aborts provider requests at the configured timeout', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const action = provider(fetchImpl as typeof fetch, 10).generatePlaylistIntent({
      prompt: 'rock',
      catalogue,
    });
    await expect(action).rejects.toMatchObject({ failure: 'timeout' });
  });

  it('is disabled without an API key', () => {
    expect(createMusicAiProvider({ MUSIC_AI_API_KEY: undefined } as EnvConfig)).toBeNull();
  });

  it('rejects a structured response that violates the intent schema', async () => {
    const planner = new MusicAiIntentPlanner({
      generatePlaylistIntent: vi.fn(async () => ({ ...rawIntent(), seedMode: 'wild' })),
    });
    await expect(planner.plan('rock', catalogue)).rejects.toBeInstanceOf(MusicAiProviderError);
  });
});

describe('PlaylistIntent grounding and normalization', () => {
  it('clamps count, years, weights, and all numeric biases', () => {
    const normalized = normalizePlaylistIntent(
      rawIntent({
        targetCount: 500,
        genres: [{ name: 'ROCK!', weight: 7, mode: 'soft' }],
        year: { min: 4000, max: 1200, weight: -4, mode: 'hard' },
        exploration: 4,
        familiarity: -2,
        favoriteBias: 8,
        unheardBias: -1,
        lowPlayCountBias: 2,
        oldLibraryBias: 3,
        recentPlayPenalty: -5,
        artistDiversity: 9,
        albumDiversity: -9,
      }),
      catalogue,
    );
    expect(normalized.targetCount).toBe(100);
    expect(normalized.genres).toEqual([{ name: 'rock', weight: 1, mode: 'soft' }]);
    expect(normalized.year).toMatchObject({ min: 1800, weight: 0, mode: 'hard' });
    expect(normalized.year.max).toBeLessThanOrEqual(new Date().getUTCFullYear() + 2);
    expect(normalized.exploration).toBe(1);
    expect(normalized.familiarity).toBe(0);
    expect(normalized.favoriteBias).toBe(1);
    expect(normalized.unheardBias).toBe(0);
    expect(normalized.albumDiversity).toBe(0);
  });

  it('grounds exact, token-overlap, and parent genre names deterministically', () => {
    const names = catalogue.availableGenres.map((genre) => genre.name);
    expect(groundGenreName('Alternative Rock', names)).toBe('alternative rock');
    expect(groundGenreName('dream rock', names)).toBe('rock');
    expect(groundGenreName('totally invented style', names)).toBeNull();
  });

  it('drops unknown hallucinated genres instead of emptying the playlist', () => {
    const normalized = normalizePlaylistIntent(
      rawIntent({
        genres: [{ name: 'impossible moon genre', weight: 1, mode: 'hard' }],
        excludedGenres: ['Rock'],
      }),
      catalogue,
    );
    expect(normalized.genres).toEqual([]);
    expect(normalized.excludedGenres).toEqual(['rock']);
  });

  it('keeps prompt-level hariç/except genre semantics hard and removes positive overlap', () => {
    const normalized = normalizePlaylistIntent(
      rawIntent({ genres: [{ name: 'rock', weight: 1, mode: 'soft' }] }),
      catalogue,
      'Rock hariç beni şaşırt',
    );
    expect(normalized.genres).toEqual([]);
    expect(normalized.excludedGenres).toEqual(['rock']);
  });

  it.each([
    ['türkçe pop 2000ler', { language: 'hard', genre: 'hard', year: 'hard', excludedGenres: [] }],
    [
      '2000ler ağırlıklı türkçe pop',
      { language: 'hard', genre: 'hard', year: 'soft', excludedGenres: [] },
    ],
    [
      'türkçe ağırlıklı 2000ler pop',
      { language: 'soft', genre: 'hard', year: 'hard', excludedGenres: [] },
    ],
    [
      'türkçe pop, yabancı da arada olabilir',
      { language: 'soft', genre: 'hard', year: 'soft', excludedGenres: [] },
    ],
    [
      '2000ler türkçe pop, rap olmasın',
      { language: 'hard', genre: 'hard', year: 'hard', excludedGenres: ['rap'] },
    ],
  ] as const)('deterministically scopes categorical softness for %s', (prompt, expected) => {
    const normalized = normalizePlaylistIntent(
      rawIntent({
        genres: [
          { name: 'pop', weight: 1, mode: 'soft' },
          ...(prompt.includes('rap') ? [{ name: 'rap', weight: 0.5, mode: 'soft' as const }] : []),
        ],
        year: { min: 2000, max: 2009, weight: 1, mode: 'soft' },
        language: { languages: ['tr'], excludedLanguages: [], weight: 1, mode: 'soft' },
      }),
      catalogue,
      prompt,
    );
    expect(normalized.language.mode).toBe(expected.language);
    expect(normalized.genres.find((genre) => genre.name === 'pop')?.mode).toBe(expected.genre);
    expect(normalized.year.mode).toBe(expected.year);
    expect(normalized.excludedGenres).toEqual(expected.excludedGenres);
  });

  it('treats an intermittent second genre as an explicit allowed family', () => {
    const normalized = normalizePlaylistIntent(
      rawIntent({ genres: [{ name: 'pop', weight: 1, mode: 'soft' }] }),
      catalogue,
      '2000ler pop, arada rock da olabilir',
    );
    expect(normalized.year).toMatchObject({ min: 2000, max: 2009, mode: 'hard' });
    expect(normalized.genres).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pop', mode: 'hard', weight: 1 }),
        expect.objectContaining({ name: 'rock', mode: 'hard', weight: 0.35 }),
      ]),
    );
  });

  it('grounds a locally known named artist as hard without sending artist vocabulary upstream', () => {
    const normalized = normalizePlaylistIntent(rawIntent(), catalogue, 'Gülşen 2000ler', {
      artistNames: ['Gülşen', 'Göksel'],
    });
    expect(normalized.artists).toEqual([
      expect.objectContaining({ name: 'gulsen', mode: 'hard', weight: 1 }),
    ]);
    expect(normalized.year).toMatchObject({ min: 2000, max: 2009, mode: 'hard' });
  });

  it('builds a bounded aggregate with no track, album, or artist names', () => {
    const candidates = Array.from({ length: 10_000 }, (_, index) => candidate(index));
    const summary = buildMusicCatalogueSummary(candidates);
    const prompt = buildMusicAiPlannerPrompt({ prompt: 'surprise me', catalogue: summary });
    expect(summary.totalTrackCount).toBe(10_000);
    expect(summary.availableGenres.length).toBeLessThanOrEqual(120);
    expect(prompt).not.toContain('Track 9999');
    expect(prompt).not.toContain('Album 999');
    expect(prompt).not.toContain('Artist 999');
  });
});

const candidate = (index: number): DiscoveryCandidate => ({
  id: `track-${index}`,
  title: `Track ${index}`,
  discNumber: 1,
  trackNumber: index + 1,
  artistId: `artist-${index % 80}`,
  artistName: `Artist ${index % 80}`,
  artistArtworkUrl: null,
  albumId: `album-${index % 200}`,
  albumTitle: `Album ${index % 200}`,
  albumYear: index % 2 ? 1995 : 2015,
  genres: [index % 2 ? 'Rock' : 'Pop'],
  albumGenres: [],
  year: index % 2 ? 1995 : 2015,
  duration: 180,
  playCount: index % 2 ? 0 : 20,
  isFavorite: index % 4 === 0,
  languageCode: null,
  languageSource: null,
  languageConfidence: null,
  createdAt: new Date(Date.UTC(2010 + (index % 15), 0, 1)),
  updatedAt: new Date(Date.UTC(2026, 0, 1)),
});

const historyFor = (candidates: DiscoveryCandidate[]): AiPlaylistHistoryEntry[] =>
  candidates
    .filter((item) => item.playCount > 0)
    .map((item, index) => ({
      trackId: item.id,
      playedAt: new Date(Date.UTC(2026, 0, 1 - (index % 300))),
      listenedSeconds: 60,
      track: { duration: item.duration },
    }));

describe('local AI playlist selection', () => {
  const candidates = Array.from({ length: 1_000 }, (_, index) => candidate(index));
  const history = historyFor(candidates);

  it('meaningfully promotes unheard and low-play-count tracks', () => {
    const intent = normalizePlaylistIntent(
      rawIntent({
        targetCount: 100,
        unheardBias: 1,
        lowPlayCountBias: 1,
        exploration: 1,
        familiarity: 0,
        seedMode: 'discovery',
      }),
      catalogue,
    );
    const selected = selectAiPlaylistCandidates(candidates, history, intent, 'unheard-a');
    expect(selected.filter((item) => item.playCount === 0).length).toBeGreaterThan(75);
  });

  it('increases the favorite ratio without losing diversity', () => {
    const intent = normalizePlaylistIntent(
      rawIntent({ targetCount: 100, favoriteBias: 1, familiarity: 0.8 }),
      catalogue,
    );
    const selected = selectAiPlaylistCandidates(candidates, history, intent, 'favorites-a');
    expect(selected.filter((item) => item.isFavorite).length).toBeGreaterThanOrEqual(35);
    expect(new Set(selected.map((item) => item.artistId)).size).toBeGreaterThan(30);
    expect(Math.max(...countBy(selected, (item) => item.artistId!).values())).toBeLessThanOrEqual(
      2,
    );
    expect(Math.max(...countBy(selected, (item) => item.albumId!).values())).toBeLessThanOrEqual(1);
  });

  it('gives a soft 1990s rock request strong year and genre affinity', () => {
    const intent = normalizePlaylistIntent(
      rawIntent({
        targetCount: 100,
        genres: [{ name: 'rock', weight: 1, mode: 'soft' }],
        year: { min: 1990, max: 1999, weight: 1, mode: 'soft' },
        favoriteBias: 0,
        unheardBias: 0,
        lowPlayCountBias: 0,
        oldLibraryBias: 0,
        recentPlayPenalty: 0,
        familiarity: 0,
        exploration: 0,
      }),
      catalogue,
    );
    const selected = selectAiPlaylistCandidates(candidates, history, intent, 'nineties-rock');
    expect(
      selected.filter((item) => item.year === 1995 && item.genres.includes('Rock')).length,
    ).toBeGreaterThanOrEqual(70);
  });

  it('is deterministic for one generation and changes for another', () => {
    const intent = normalizePlaylistIntent(rawIntent({ targetCount: 100 }), catalogue);
    const first = selectAiPlaylistCandidates(candidates, history, intent, 'same-generation');
    const repeated = selectAiPlaylistCandidates(candidates, history, intent, 'same-generation');
    const next = selectAiPlaylistCandidates(candidates, history, intent, 'next-generation');
    expect(repeated.map((item) => item.id)).toEqual(first.map((item) => item.id));
    const overlap = next.filter((item) => first.some((current) => current.id === item.id)).length;
    expect(overlap).toBeLessThan(75);
  });

  it('relaxes soft preferences but preserves explicit hard constraints and exclusions', () => {
    const small = candidates.map((item, index) => ({
      ...item,
      genres: index < 17 ? ['Rock'] : ['Pop'],
    }));
    const soft = normalizePlaylistIntent(
      rawIntent({ genres: [{ name: 'rock', weight: 1, mode: 'soft' }] }),
      catalogue,
    );
    const hard = normalizePlaylistIntent(
      rawIntent({ genres: [{ name: 'rock', weight: 1, mode: 'hard' }] }),
      catalogue,
    );
    const excluded = normalizePlaylistIntent(rawIntent({ excludedGenres: ['pop'] }), catalogue);
    expect(selectAiPlaylistCandidates(small, history, soft, 'soft').length).toBe(50);
    expect(selectAiPlaylistCandidates(small, history, hard, 'hard')).toHaveLength(17);
    expect(
      selectAiPlaylistCandidates(small, history, excluded, 'excluded').every((item) =>
        item.genres.includes('Rock'),
      ),
    ).toBe(true);
  });

  it('never fills an exclusive 1990s Turkish rock request with constraint violations', () => {
    const fixtures: DiscoveryCandidate[] = [
      candidate(1),
      candidate(2),
      candidate(3),
      candidate(4),
      candidate(5),
      candidate(6),
    ].map((item, index) => ({
      ...item,
      id: `semantic-${index}`,
      artistId: `semantic-artist-${index}`,
      albumId: `semantic-album-${index}`,
      year: [1994, 1998, 1995, 1999, 1996, 2004][index]!,
      albumYear: [1994, 1998, 1995, 1999, 1996, 2004][index]!,
      genres: index === 4 ? ['Pop'] : ['Rock'],
      languageCode: index < 2 || index >= 4 ? 'tr' : 'en',
      languageSource: 'lyrics_metadata',
      languageConfidence: 1,
    }));
    const intent = normalizePlaylistIntent(
      rawIntent({
        targetCount: 50,
        genres: [{ name: 'turkish rock', weight: 1, mode: 'soft' }],
        year: { min: 1990, max: 1999, weight: 1, mode: 'soft' },
        language: { languages: [], excludedLanguages: [], weight: 1, mode: 'soft' },
        locale: { countries: ['TR'], scenes: ['Turkish'], weight: 1, mode: 'hard' },
      }),
      catalogue,
      "Sadece 90'lar Türkçe rock",
    );
    const selected = selectAiPlaylistCandidates(fixtures, [], intent, 'exclusive-turkish-rock');
    expect(selected.map((item) => item.id).sort()).toEqual(['semantic-0', 'semantic-1']);
    expect(intent).toMatchObject({
      genres: [{ name: 'rock', mode: 'hard' }],
      year: { min: 1990, max: 1999, mode: 'hard' },
      language: { languages: ['tr'], mode: 'hard' },
      locale: { countries: [], scenes: [], mode: 'soft' },
    });
    expect(explainCandidateIntent(fixtures[2]!, intent)).toMatchObject({
      yearMatch: true,
      genreMatch: true,
      languageMatch: { status: 'mismatch', source: 'lyrics_metadata' },
      hardConstraintPassed: false,
    });
  });

  it('can fill a soft Turkish 1990s rock preference with other rock tracks', () => {
    const fixtures = Array.from({ length: 60 }, (_, index) => ({
      ...candidate(index),
      genres: ['Rock'],
      year: index < 5 ? 1995 : 2005,
      albumYear: index < 5 ? 1995 : 2005,
      languageCode: index < 5 ? 'tr' : 'en',
      languageSource: 'lyrics_metadata',
      languageConfidence: 1,
    }));
    const intent = normalizePlaylistIntent(
      rawIntent({
        genres: [{ name: 'rock', weight: 1, mode: 'soft' }],
        year: { min: 1990, max: 1999, weight: 1, mode: 'soft' },
        language: { languages: ['tr'], excludedLanguages: [], weight: 1, mode: 'soft' },
      }),
      catalogue,
      "90'lar ağırlıklı, biraz Türkçe, rock ağırlıklı",
    );
    const selected = selectAiPlaylistCandidates(fixtures, [], intent, 'soft-turkish-rock');
    expect(selected).toHaveLength(50);
    expect(selected.some((item) => item.languageCode === 'en')).toBe(true);
  });

  it('selects only Turkish pop tracks from the 2000s for the unqualified real prompt', () => {
    const fixtures: DiscoveryCandidate[] = [
      ['Gülşen', 'tr', 'Pop', 2006],
      ['Göksel', 'tr', 'Turkish Pop', 2005],
      ['Zeynep Dizdar', 'tr', 'Pop', 2004],
      ['Duman', 'tr', 'Rock', 2005],
      ['Kargo', 'tr', 'Rock', 2000],
      ['Sagopa Kajmer', 'tr', 'Rap', 2005],
      ['Michael Jackson', 'en', 'Pop', 2001],
      ['Papa Roach', 'en', 'Rock', 2000],
      ['Nineties Pop', 'tr', 'Pop', 1997],
      ['Modern Pop', 'tr', 'Pop', 2012],
    ].map(([artist, language, genre, year], index) => ({
      ...candidate(index),
      id: `real-${index}`,
      artistId: `real-artist-${index}`,
      artistName: String(artist),
      albumId: `real-album-${index}`,
      languageCode: String(language),
      languageSource: 'lyrics_metadata',
      languageConfidence: 1,
      genres: [String(genre)],
      year: Number(year),
      albumYear: Number(year),
    }));
    const intent = normalizePlaylistIntent(
      rawIntent({
        targetCount: 50,
        genres: [{ name: 'pop', weight: 1, mode: 'soft' }],
        year: { min: 2000, max: 2009, weight: 1, mode: 'soft' },
        language: { languages: ['tr'], excludedLanguages: [], weight: 1, mode: 'soft' },
      }),
      catalogue,
      'türkçe pop 2000ler',
    );
    const selected = selectAiPlaylistCandidates(fixtures, [], intent, 'real-turkish-pop-2000s');
    expect(selected.map((item) => item.artistName).sort()).toEqual([
      'Göksel',
      'Gülşen',
      'Zeynep Dizdar',
    ]);
    expect(selected).toHaveLength(3);
    expect(intent).toMatchObject({
      targetCount: 50,
      genres: [expect.objectContaining({ name: 'pop', mode: 'hard' })],
      year: { min: 2000, max: 2009, mode: 'hard' },
      language: { languages: ['tr'], mode: 'hard' },
    });
    expect(describeHardIntentConstraints(intent)).toEqual(['Türkçe', 'Pop', '2000–2009']);

    const [duman, michael, papaRoach] = [fixtures[3]!, fixtures[6]!, fixtures[7]!].map((item) =>
      explainCandidateIntent(item, intent),
    );
    expect(duman).toMatchObject({
      languageMatch: { status: 'match' },
      genreMatch: false,
      yearMatch: true,
      hardConstraintPassed: false,
    });
    expect(michael).toMatchObject({
      languageMatch: { status: 'mismatch' },
      genreMatch: true,
      yearMatch: true,
      hardConstraintPassed: false,
    });
    expect(papaRoach).toMatchObject({
      languageMatch: { status: 'mismatch' },
      genreMatch: false,
      yearMatch: true,
      hardConstraintPassed: false,
    });
  });

  it('excludes confirmed non-Turkish and unknown tracks from a Turkish-only request', () => {
    const fixtures = [
      {
        ...candidate(1),
        id: 'turkish',
        languageCode: 'tr',
        languageSource: 'lyrics_detected',
        languageConfidence: 0.97,
      },
      {
        ...candidate(2),
        id: 'english',
        languageCode: 'en',
        languageSource: 'lyrics_detected',
        languageConfidence: 0.97,
      },
      { ...candidate(3), id: 'unknown' },
    ];
    const intent = normalizePlaylistIntent(rawIntent(), catalogue, 'Sadece Türkçe');
    expect(
      selectAiPlaylistCandidates(fixtures, [], intent, 'turkish-only').map((item) => item.id),
    ).toEqual(['turkish']);
  });

  it('uses persisted edition year and never guesses an original year from a remaster title', () => {
    const remaster = {
      ...candidate(1),
      id: 'remaster',
      title: 'Wrathchild (1998 Remaster)',
      year: 1998,
      albumYear: 1998,
    };
    const intent = normalizePlaylistIntent(
      rawIntent({ year: { min: 1990, max: 1999, weight: 1, mode: 'hard' } }),
      catalogue,
    );
    expect(explainCandidateIntent(remaster, intent).yearMatch).toBe(true);
  });
});

const countBy = <T>(values: T[], key: (value: T) => string) => {
  const result = new Map<string, number>();
  for (const value of values) result.set(key(value), (result.get(key(value)) || 0) + 1);
  return result;
};

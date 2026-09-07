import {
  PLAYLIST_INTENT_TARGET_DEFAULT,
  PLAYLIST_INTENT_TARGET_MAX,
  PLAYLIST_INTENT_TARGET_MIN,
  playlistIntentProviderSchema,
  playlistIntentSchema,
  type PlaylistIntent,
  type PlaylistIntentProviderOutput,
} from '@cinedrive/shared';
import type { DiscoveryCandidate } from './music-discovery-candidates.js';
import { normalizeGenre } from './music-discovery.service.js';
import type { MusicAiProvider, MusicCatalogueSummary } from './music-ai-provider.js';
import { MusicAiProviderError } from './music-ai-provider.js';

const MAX_GENRE_VOCABULARY = 120;
const MIN_REASONABLE_YEAR = 1800;
const SAFE_GENRE_FAMILIES = new Set([
  'alternative',
  'blues',
  'classical',
  'country',
  'electronic',
  'folk',
  'indie',
  'jazz',
  'metal',
  'pop',
  'punk',
  'r b',
  'rap',
  'reggae',
  'rock',
  'soul',
]);

const LANGUAGE_ALIASES = new Map<string, string>([
  ['tr', 'tr'],
  ['tur', 'tr'],
  ['turkish', 'tr'],
  ['turkce', 'tr'],
  ['en', 'en'],
  ['eng', 'en'],
  ['english', 'en'],
  ['ingilizce', 'en'],
  ['ja', 'ja'],
  ['jpn', 'ja'],
  ['japanese', 'ja'],
  ['japonca', 'ja'],
  ['ko', 'ko'],
  ['kor', 'ko'],
  ['korean', 'ko'],
  ['korece', 'ko'],
  ['fr', 'fr'],
  ['fra', 'fr'],
  ['fre', 'fr'],
  ['french', 'fr'],
  ['fransizca', 'fr'],
  ['de', 'de'],
  ['deu', 'de'],
  ['ger', 'de'],
  ['german', 'de'],
  ['almanca', 'de'],
  ['es', 'es'],
  ['spa', 'es'],
  ['spanish', 'es'],
  ['ispanyolca', 'es'],
]);

const COUNTRY_ALIASES = new Map<string, string>([
  ['tr', 'TR'],
  ['turkey', 'TR'],
  ['turkiye', 'TR'],
  ['turkish', 'TR'],
  ['gb', 'GB'],
  ['uk', 'GB'],
  ['britain', 'GB'],
  ['british', 'GB'],
  ['jp', 'JP'],
  ['japan', 'JP'],
  ['japanese', 'JP'],
  ['kr', 'KR'],
  ['korea', 'KR'],
  ['korean', 'KR'],
  ['fr', 'FR'],
  ['france', 'FR'],
  ['french', 'FR'],
]);

const normalizeSemanticText = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const normalizeLanguageCode = (value: string): string | null => {
  const normalized = normalizeSemanticText(value).split(' ')[0] || '';
  return LANGUAGE_ALIASES.get(normalized) || (/^[a-z]{2,3}$/.test(normalized) ? normalized : null);
};

const normalizeCountryCode = (value: string): string | null => {
  const normalized = normalizeSemanticText(value);
  return (
    COUNTRY_ALIASES.get(normalized) ||
    (/^[a-z]{2}$/.test(normalized) ? normalized.toUpperCase() : null)
  );
};

const languageWords = new Map([...LANGUAGE_ALIASES.entries()].filter(([word]) => word.length > 2));

const extractLanguages = (value: string) => {
  const normalized = ` ${normalizeSemanticText(value)} `;
  return [
    ...new Set(
      [...languageWords].flatMap(([word, code]) =>
        normalized.includes(` ${word} `) ? [code] : [],
      ),
    ),
  ];
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isFacetSoftened = (prompt: string, phrase: string) => {
  const escaped = escapeRegex(normalizeSemanticText(phrase));
  if (!escaped) return false;
  const postfix = new RegExp(`\\b${escaped}\\s+(?:agirlikli|agirlikta)\\b`);
  const prefix = new RegExp(
    `\\b(?:biraz|arada|cogunlukla|preferably|mostly|mainly|leaning\\s+toward)\\s+${escaped}\\b`,
  );
  return postfix.test(prompt) || prefix.test(prompt);
};

const hasForeignAllowance = (prompt: string) =>
  /\b(yabanci|foreign)\b.{0,24}\b(arada|olabilir|too|also|allowed)\b/.test(prompt);

const stripLanguageQualifiers = (value: string) => {
  let normalized = ` ${normalizeSemanticText(value)} `;
  for (const word of languageWords.keys()) normalized = normalized.replaceAll(` ${word} `, ' ');
  return normalized.trim().replace(/\s+/g, ' ');
};

const hasExclusiveCue = (prompt: string) =>
  /\b(sadece|yalnizca|only|exclusively)\b/.test(normalizeSemanticText(prompt));

type PromptYearConstraint = { min: number; max: number; phrase: string };

const inferPromptYearConstraint = (prompt: string): PromptYearConstraint | null => {
  const normalized = normalizeSemanticText(prompt);
  const range = prompt
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .match(/\b((?:19|20)\d{2})\s*(?:-|–|—|ile|to)\s*((?:19|20)\d{2})\b/);
  if (range) {
    const left = Number(range[1]);
    const right = Number(range[2]);
    return { min: Math.min(left, right), max: Math.max(left, right), phrase: range[0] };
  }
  const decade = normalized.match(
    /(?:^|\s)(\d{2}|(?:19|20)\d{2})\s*(?:s|lar|ler)(?:dan|den)?(?:\s|$)/,
  );
  if (decade) {
    const value = Number(decade[1]);
    const start = value < 100 ? (value >= 30 ? 1900 + value : 2000 + value) : value;
    return { min: start, max: start + 9, phrase: decade[0].trim() };
  }
  const year = normalized.match(/(?:^|\s)((?:19|20)\d{2})(?:\s|$)/);
  return year ? { min: Number(year[1]), max: Number(year[1]), phrase: year[1]! } : null;
};

export interface PlaylistIntentLocalContext {
  /** Used only after the provider call. It is never included in provider context. */
  artistNames?: string[];
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const normalizeArtistName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .trim();

const meaningfulGenre = (genre: string) =>
  genre.length >= 3 &&
  !new Set(['other', 'non music', 'speech', 'spoken word', 'interview', 'sports']).has(genre);

export const buildMusicCatalogueSummary = (
  candidates: DiscoveryCandidate[],
): MusicCatalogueSummary => {
  const genreCounts = new Map<string, number>();
  const decadeCounts = new Map<number, number>();
  let yearMin = Number.POSITIVE_INFINITY;
  let yearMax = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const genres = new Set(
      [...candidate.genres, ...candidate.albumGenres].map(normalizeGenre).filter(meaningfulGenre),
    );
    for (const genre of genres) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    const year = candidate.year || candidate.albumYear;
    if (year && year >= MIN_REASONABLE_YEAR && year <= 3000) {
      yearMin = Math.min(yearMin, year);
      yearMax = Math.max(yearMax, year);
      const decade = Math.floor(year / 10) * 10;
      decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
    }
  }

  return {
    totalTrackCount: candidates.length,
    availableGenres: [...genreCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_GENRE_VOCABULARY)
      .map(([name, count]) => ({ name, count })),
    yearRange:
      Number.isFinite(yearMin) && Number.isFinite(yearMax) ? { min: yearMin, max: yearMax } : null,
    decades: [...decadeCounts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([decade, count]) => ({ decade, count })),
  };
};

const genreMatchScore = (requested: string, available: string) => {
  if (requested === available) return 1;
  if (requested.includes(available) || available.includes(requested)) return 0.75;
  const requestedTokens = new Set(requested.split(' ').filter(Boolean));
  const availableTokens = new Set(available.split(' ').filter(Boolean));
  const overlap = [...requestedTokens].filter((token) => availableTokens.has(token)).length;
  return overlap / Math.max(requestedTokens.size, availableTokens.size, 1);
};

export const groundGenreName = (name: string, availableGenres: string[]): string | null => {
  const requested = normalizeGenre(name);
  if (!requested) return null;
  let best: { name: string; score: number } | null = null;
  for (const available of availableGenres) {
    const score = genreMatchScore(requested, available);
    if (!best || score > best.score || (score === best.score && available < best.name))
      best = { name: available, score };
  }
  return best && best.score >= 0.34 ? best.name : null;
};

const normalizeWeightedNames = (
  values: PlaylistIntentProviderOutput['genres'],
  normalizeName: (name: string) => string | null,
) => {
  const normalized = new Map<string, { name: string; weight: number; mode: 'soft' | 'hard' }>();
  for (const value of values) {
    const name = normalizeName(value.name);
    if (!name) continue;
    const existing = normalized.get(name);
    const next = { name, weight: clamp(value.weight), mode: value.mode };
    if (!existing || next.weight > existing.weight || next.mode === 'hard')
      normalized.set(name, next);
  }
  return [...normalized.values()];
};

export const normalizePlaylistIntent = (
  raw: PlaylistIntentProviderOutput,
  catalogue: MusicCatalogueSummary,
  prompt = '',
  localContext: PlaylistIntentLocalContext = {},
): PlaylistIntent => {
  const availableGenres = catalogue.availableGenres.map((genre) => genre.name);
  const promptText = normalizeSemanticText(prompt);
  const exclusive = hasExclusiveCue(prompt);
  const promptLanguages = extractLanguages(prompt);
  const genreLanguages = raw.genres.flatMap((genre) => extractLanguages(genre.name));
  const requestedLanguages = [
    ...new Set(
      promptLanguages.length
        ? promptLanguages
        : [
            ...raw.language.languages
              .map(normalizeLanguageCode)
              .filter((value): value is string => !!value),
            ...genreLanguages,
          ],
    ),
  ].slice(0, 8);
  const excludedLanguages = [
    ...new Set(
      raw.language.excludedLanguages
        .map(normalizeLanguageCode)
        .filter((value): value is string => !!value),
    ),
  ].slice(0, 8);
  for (const [word, language] of languageWords) {
    if (
      promptText.includes(`${word} haric`) ||
      promptText.includes(`except ${word}`) ||
      promptText.includes(`${word} except`)
    ) {
      const positiveIndex = requestedLanguages.indexOf(language);
      if (positiveIndex >= 0) requestedLanguages.splice(positiveIndex, 1);
      if (!excludedLanguages.includes(language)) excludedLanguages.push(language);
    }
  }

  const maximumYear = Math.min(3000, new Date().getUTCFullYear() + 2);
  const normalizeYear = (value: number | null) =>
    value === null ? null : Math.round(clamp(value, MIN_REASONABLE_YEAR, maximumYear));
  let yearMin = normalizeYear(raw.year.min);
  let yearMax = normalizeYear(raw.year.max);
  if (yearMin !== null && yearMax !== null && yearMin > yearMax)
    [yearMin, yearMax] = [yearMax, yearMin];
  const promptYear = inferPromptYearConstraint(prompt);
  if (promptYear) {
    yearMin = promptYear.min;
    yearMax = promptYear.max;
  }

  const providerGenres = raw.genres
    .map((genre) => ({
      ...genre,
      name: stripLanguageQualifiers(genre.name),
      mode: prompt ? ('soft' as const) : genre.mode,
    }))
    .filter((genre) => genre.name);
  const explicitPromptGenres = [
    ...new Set(
      availableGenres.flatMap((genre) => {
        const normalized = normalizeSemanticText(genre);
        if (!normalized || !` ${promptText} `.includes(` ${normalized} `)) return [];
        const withoutLanguage = stripLanguageQualifiers(normalized);
        return withoutLanguage ? [withoutLanguage] : [];
      }),
    ),
  ]
    .concat([...SAFE_GENRE_FAMILIES].filter((genre) => ` ${promptText} `.includes(` ${genre} `)))
    .filter(
      (genre, _index, all) =>
        !all.some(
          (other) =>
            other !== genre && normalizeSemanticText(other).includes(normalizeSemanticText(genre)),
        ),
    )
    .map((name) => ({
      name,
      softened: isFacetSoftened(promptText, name),
      allowance: new RegExp(`\\b(?:arada|also)\\s+${escapeRegex(name)}\\b`).test(promptText),
    }));
  const hasStrictPromptGenre = explicitPromptGenres.some(
    (genre) => !genre.softened && !genre.allowance,
  );
  const promptGenreMatches = explicitPromptGenres.map(({ name, softened, allowance }) => ({
    name,
    weight: allowance ? 0.35 : 1,
    mode:
      exclusive || (allowance && hasStrictPromptGenre) || !softened
        ? ('hard' as const)
        : ('soft' as const),
  }));

  const promptExcludedGenres = [...SAFE_GENRE_FAMILIES].filter(
    (genre) =>
      promptText.includes(`${genre} haric`) ||
      promptText.includes(`except ${genre}`) ||
      promptText.includes(`${genre} olmasin`) ||
      promptText.includes(`without ${genre}`) ||
      promptText.includes(`no ${genre}`),
  );
  const normalizedExcludedGenres = [
    ...new Set([
      ...raw.excludedGenres.flatMap((name) => {
        const grounded = groundGenreName(name, availableGenres);
        return grounded ? [grounded] : [];
      }),
      ...promptExcludedGenres,
    ]),
  ];

  const normalizedLocaleCountries = raw.locale.countries
    .map(normalizeCountryCode)
    .filter((value): value is string => !!value);
  const normalizedLocaleScenes = raw.locale.scenes.map(normalizeSemanticText).filter(Boolean);
  // “Türkçe” is explicitly a language. Do not let a provider silently turn it
  // into artist nationality; country/local-scene requests need their own cue.
  if (
    /\bturkce\b/.test(promptText) &&
    !/\b(turkiye|turk sanatci|yerli|anadolu|anatolian)\b/.test(promptText)
  ) {
    for (let index = normalizedLocaleCountries.length - 1; index >= 0; index -= 1)
      if (normalizedLocaleCountries[index] === 'TR') normalizedLocaleCountries.splice(index, 1);
    for (let index = normalizedLocaleScenes.length - 1; index >= 0; index -= 1)
      if (['turkish', 'turkce', 'turkiye'].includes(normalizedLocaleScenes[index]!))
        normalizedLocaleScenes.splice(index, 1);
  }

  const localArtistMatches = (localContext.artistNames || [])
    .map((name) => ({ original: name, normalized: normalizeArtistName(name) }))
    .filter(({ normalized }) => normalized && ` ${promptText} `.includes(` ${normalized} `))
    .sort((left, right) => right.normalized.length - left.normalized.length)
    .filter(
      (artist, index, all) =>
        !all.slice(0, index).some((other) => other.normalized.includes(artist.normalized)),
    )
    .map(({ original, normalized }) => ({
      name: original,
      weight: 1,
      mode:
        exclusive || !isFacetSoftened(promptText, normalized)
          ? ('hard' as const)
          : ('soft' as const),
    }));
  const providerArtists = raw.artists.map((artist) => {
    const normalized = normalizeArtistName(artist.name);
    const explicitlyNamed = normalized && ` ${promptText} `.includes(` ${normalized} `);
    return {
      ...artist,
      mode:
        explicitlyNamed && (exclusive || !isFacetSoftened(promptText, normalized))
          ? ('hard' as const)
          : ('soft' as const),
    };
  });

  const languageSoftened =
    hasForeignAllowance(promptText) ||
    promptLanguages.some((language) =>
      [...languageWords].some(
        ([word, code]) =>
          code === language &&
          ` ${promptText} `.includes(` ${word} `) &&
          isFacetSoftened(promptText, word),
      ),
    );
  const localeSoftened = [...raw.locale.countries, ...raw.locale.scenes].some((value) =>
    isFacetSoftened(promptText, value),
  );

  const intent: PlaylistIntent = {
    ...raw,
    title: raw.title.trim(),
    subtitle: raw.subtitle.trim(),
    targetCount: Math.round(
      clamp(
        Number.isFinite(raw.targetCount) ? raw.targetCount : PLAYLIST_INTENT_TARGET_DEFAULT,
        PLAYLIST_INTENT_TARGET_MIN,
        PLAYLIST_INTENT_TARGET_MAX,
      ),
    ),
    genres: normalizeWeightedNames([...providerGenres, ...promptGenreMatches], (name) => {
      const normalized = normalizeGenre(name);
      const grounded = groundGenreName(normalized, availableGenres);
      return grounded || (SAFE_GENRE_FAMILIES.has(normalized) ? normalized : null);
    }).filter((genre) => !normalizedExcludedGenres.includes(genre.name)),
    excludedGenres: normalizedExcludedGenres,
    artists: normalizeWeightedNames(
      [...providerArtists, ...localArtistMatches],
      (name) => normalizeArtistName(name) || null,
    ),
    excludedArtistNames: [
      ...new Set(raw.excludedArtistNames.map(normalizeArtistName).filter(Boolean)),
    ],
    year: {
      min: yearMin,
      max: yearMax,
      weight: promptYear ? Math.max(0.8, clamp(raw.year.weight)) : clamp(raw.year.weight),
      mode: promptYear
        ? exclusive || !isFacetSoftened(promptText, promptYear.phrase)
          ? 'hard'
          : 'soft'
        : raw.year.mode,
    },
    language: {
      languages: requestedLanguages,
      excludedLanguages,
      weight: promptLanguages.length
        ? Math.max(0.8, clamp(raw.language.weight))
        : clamp(raw.language.weight),
      mode: promptLanguages.length
        ? exclusive || !languageSoftened
          ? 'hard'
          : 'soft'
        : raw.language.mode,
    },
    locale: {
      countries: [...new Set(normalizedLocaleCountries)].slice(0, 8),
      scenes: [...new Set(normalizedLocaleScenes)].slice(0, 8),
      weight: clamp(raw.locale.weight),
      mode:
        !normalizedLocaleCountries.length && !normalizedLocaleScenes.length
          ? 'soft'
          : exclusive
            ? 'hard'
            : localeSoftened
              ? 'soft'
              : 'hard',
    },
    exploration: clamp(raw.exploration),
    familiarity: clamp(raw.familiarity),
    favoriteBias: clamp(raw.favoriteBias),
    unheardBias: clamp(raw.unheardBias),
    lowPlayCountBias: clamp(raw.lowPlayCountBias),
    oldLibraryBias: clamp(raw.oldLibraryBias),
    recentPlayPenalty: clamp(raw.recentPlayPenalty),
    artistDiversity: clamp(raw.artistDiversity),
    albumDiversity: clamp(raw.albumDiversity),
  };
  return playlistIntentSchema.parse(intent);
};

export class MusicAiIntentPlanner {
  constructor(private readonly provider: MusicAiProvider) {}

  public async plan(
    prompt: string,
    catalogue: MusicCatalogueSummary,
    localContext: PlaylistIntentLocalContext = {},
  ): Promise<PlaylistIntent> {
    const output = await this.provider.generatePlaylistIntent({ prompt, catalogue });
    const parsed = playlistIntentProviderSchema.safeParse(output);
    if (!parsed.success) throw new MusicAiProviderError('malformed-response');
    return normalizePlaylistIntent(parsed.data, catalogue, prompt, localContext);
  }
}

import { francAll } from 'franc-min';

export const MUSIC_LANGUAGE_DETECTION_VERSION = 1;
export const LYRICS_LANGUAGE_MIN_CONFIDENCE = 0.9;
export const MUSIC_LANGUAGE_BATCH_SIZE = 200;

export type MusicLanguageSource =
  | 'manual'
  | 'lyrics_metadata'
  | 'lyrics_detected'
  | 'genre'
  | 'artist_locale'
  | 'unknown';

export interface TrackLanguageEvidence {
  language: string | null;
  source: MusicLanguageSource;
  confidence: number;
}

const ISO3_TO_ISO2: Record<string, string> = {
  ara: 'ar',
  cat: 'ca',
  ces: 'cs',
  dan: 'da',
  deu: 'de',
  ell: 'el',
  eng: 'en',
  fas: 'fa',
  fin: 'fi',
  fra: 'fr',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  nld: 'nl',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rus: 'ru',
  spa: 'es',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  urd: 'ur',
  vie: 'vi',
  zho: 'zh',
};

const LANGUAGE_ALIASES: Record<string, string> = {
  chinese: 'zh',
  deutsch: 'de',
  english: 'en',
  français: 'fr',
  french: 'fr',
  german: 'de',
  ingles: 'en',
  italiano: 'it',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  spanish: 'es',
  türkçe: 'tr',
  turkce: 'tr',
  turkish: 'tr',
};

const SUPPORTED_LANGUAGE_CODES = new Set([
  ...Object.values(ISO3_TO_ISO2),
  'az',
  'bg',
  'bn',
  'et',
  'hr',
  'is',
  'lt',
  'lv',
  'ms',
  'sk',
  'sl',
  'sr',
]);

const LANGUAGE_STOP_WORDS: Partial<Record<string, Set<string>>> = {
  tr: new Set([
    'ama', 'ben', 'beni', 'benim', 'bir', 'biz', 'bu', 'bütün', 'çok', 'da', 'de', 'diye',
    'gibi', 'için', 'ile', 'ki', 'mi', 'ne', 'neden', 'o', 'olan', 'sana', 'sen', 'seni',
    'senin', 've', 'ya', 'yine', 'yok', 'şimdi',
  ]),
  en: new Set([
    'a', 'and', 'are', 'as', 'be', 'because', 'but', 'for', 'from', 'had', 'have', 'i', 'in',
    'is', 'it', 'me', 'my', 'not', 'of', 'on', 'our', 'that', 'the', 'this', 'to', 'was',
    'we', 'were', 'when', 'with', 'you', 'your',
  ]),
  de: new Set(['aber', 'bei', 'bin', 'das', 'der', 'die', 'du', 'ein', 'eine', 'für', 'ich', 'ist', 'mit', 'nicht', 'und', 'von', 'wir', 'zu']),
  es: new Set(['con', 'de', 'el', 'en', 'es', 'la', 'las', 'los', 'mi', 'no', 'para', 'por', 'que', 'te', 'un', 'una', 'y', 'yo']),
  fr: new Set(['avec', 'ce', 'dans', 'de', 'du', 'elle', 'en', 'est', 'et', 'je', 'la', 'le', 'les', 'mais', 'mon', 'nous', 'pas', 'pour', 'que', 'qui', 'tu', 'un', 'une']),
  it: new Set(['che', 'con', 'di', 'e', 'gli', 'il', 'io', 'la', 'le', 'ma', 'mi', 'non', 'per', 'si', 'sono', 'tu', 'un', 'una']),
  pt: new Set(['com', 'de', 'do', 'e', 'ela', 'ele', 'em', 'eu', 'mas', 'me', 'não', 'o', 'os', 'para', 'por', 'que', 'se', 'um', 'uma']),
};

const EXPLICIT_GENRE_LANGUAGE: Array<[RegExp, string]> = [
  [/\b(?:turkish|turkce|türkçe)\s+(?:alternative|folk|hip\s*hop|metal|pop|rap|rock)\b/u, 'tr'],
  [/\banatolian\s+(?:folk|pop|rock)\b/u, 'tr'],
  [/\b(?:alman|german)\s+(?:pop|rap|rock)\b/u, 'de'],
  [/\b(?:french|français)\s+(?:pop|rap|rock)\b/u, 'fr'],
  [/\b(?:latin|spanish)\s+pop\b/u, 'es'],
];

const normalizeText = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const normalizeMusicLanguageCode = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase('en-US').replace(/_/g, '-');
  if (!normalized || ['auto', 'und', 'unknown', 'none', 'null', 'xx'].includes(normalized)) return null;
  const alias = LANGUAGE_ALIASES[normalized];
  if (alias) return alias;
  const base = normalized.split('-')[0]!;
  if (LANGUAGE_ALIASES[base]) return LANGUAGE_ALIASES[base]!;
  if (ISO3_TO_ISO2[base]) return ISO3_TO_ISO2[base]!;
  return /^[a-z]{2}$/.test(base) && SUPPORTED_LANGUAGE_CODES.has(base) ? base : null;
};

export const plainLyricsForLanguageDetection = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\[(?:\d{1,3}:\d{2}(?:[.:]\d{1,3})?|ar|ti|al|by|length|re|ve|la|offset):?[^\]]*\]/giu, ' ')
    .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const lexicalHits = (language: string, words: string[]) => {
  const profile = LANGUAGE_STOP_WORDS[language];
  return profile ? words.reduce((total, word) => total + Number(profile.has(word)), 0) : 0;
};

export const detectLyricsLanguage = (content: string): TrackLanguageEvidence | null => {
  const plain = plainLyricsForLanguageDetection(content);
  const words = normalizeText(plain).match(/\p{L}{2,}/gu) || [];
  const letterCount = words.reduce((total, word) => total + word.length, 0);
  if (words.length < 20 || letterCount < 100) return null;

  const ranked = francAll(plain, { minLength: 80 })
    .map(([code, score]) => ({ language: ISO3_TO_ISO2[code], score }))
    .filter((item): item is { language: string; score: number } => Boolean(item.language));
  const top = ranked[0];
  if (!top || top.score < 0.8) return null;
  const runnerUp = ranked.find((item) => item.language !== top.language);
  const francMargin = Math.max(0, top.score - (runnerUp?.score || 0));
  const topLexicalHits = lexicalHits(top.language, words);
  const competingLexicalHits = Math.max(
    0,
    ...Object.keys(LANGUAGE_STOP_WORDS)
      .filter((language) => language !== top.language)
      .map((language) => lexicalHits(language, words)),
  );
  if (topLexicalHits < 3 && francMargin < 0.15) return null;
  const lexicalMargin = Math.max(0, topLexicalHits - competingLexicalHits) / Math.max(1, topLexicalHits);
  const lengthBonus = Math.min(0.04, Math.max(0, letterCount - 100) / 2500);
  const confidence = Math.min(
    0.99,
    0.78 + Math.min(0.11, francMargin * 0.75) + Math.min(0.06, topLexicalHits * 0.006) + lexicalMargin * 0.04 + lengthBonus,
  );
  return { language: top.language, source: 'lyrics_detected', confidence };
};

export const detectLanguageFromGenres = (genres: string[]): TrackLanguageEvidence | null => {
  const normalized = normalizeText(genres.join(' '));
  for (const [pattern, language] of EXPLICIT_GENRE_LANGUAGE) {
    if (pattern.test(normalized)) return { language, source: 'genre', confidence: 0.96 };
  }
  return null;
};

export const resolveTrackLanguageEvidence = (input: {
  persistedLanguage?: string | null;
  persistedSource?: string | null;
  persistedConfidence?: number | null;
  lyricsLanguage?: string | null;
  lyricsContent?: string | null;
  lyricsSourceType?: string | null;
  genres?: string[];
  albumGenres?: string[];
}): TrackLanguageEvidence => {
  const persistedLanguage = normalizeMusicLanguageCode(input.persistedLanguage);
  if (persistedLanguage && input.persistedSource === 'manual') {
    return {
      language: persistedLanguage,
      source: 'manual',
      confidence: Math.max(0, Math.min(1, input.persistedConfidence ?? 1)),
    };
  }
  const lyricsLanguage = normalizeMusicLanguageCode(input.lyricsLanguage);
  if (lyricsLanguage) {
    return {
      language: lyricsLanguage,
      source: input.lyricsSourceType === 'manual' ? 'manual' : 'lyrics_metadata',
      confidence: 1,
    };
  }
  if (input.lyricsContent) {
    const detected = detectLyricsLanguage(input.lyricsContent);
    if (detected && detected.confidence >= LYRICS_LANGUAGE_MIN_CONFIDENCE) return detected;
  }
  const genre = detectLanguageFromGenres([...(input.genres || []), ...(input.albumGenres || [])]);
  if (genre) return genre;
  return { language: null, source: 'unknown', confidence: 0 };
};

export const isHardLanguageEvidenceAccepted = (evidence: TrackLanguageEvidence) => {
  if (!evidence.language) return false;
  if (evidence.source === 'artist_locale' || evidence.source === 'unknown') return false;
  if (evidence.source === 'genre') return evidence.confidence >= 0.95;
  return evidence.confidence >= LYRICS_LANGUAGE_MIN_CONFIDENCE;
};

export const persistedTrackLanguageEvidence = (input: {
  languageCode?: string | null;
  languageSource?: string | null;
  languageConfidence?: number | null;
}): TrackLanguageEvidence => {
  const language = normalizeMusicLanguageCode(input.languageCode);
  const source = input.languageSource as MusicLanguageSource | null | undefined;
  if (!language || !source || !['manual', 'lyrics_metadata', 'lyrics_detected', 'genre', 'artist_locale'].includes(source)) {
    return { language: null, source: 'unknown', confidence: 0 };
  }
  return { language, source, confidence: Math.max(0, Math.min(1, input.languageConfidence ?? 0)) };
};

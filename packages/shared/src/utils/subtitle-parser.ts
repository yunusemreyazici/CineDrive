export interface ParsedSubtitleInfo {
  languageCode: string;
  languageLabel: string;
  forced: boolean;
  hearingImpaired: boolean;
  isDefault: boolean;
  sourceFormat: 'vtt' | 'srt';
}

const LANGUAGE_LABELS: Record<string, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  ru: 'Русский',
  ar: 'العربية',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
};

/**
 * Release groups label sidecar files with ISO 639-2 as often as 639-1, so
 * `Movie.eng.srt` is at least as common as `Movie.en.srt`. The filename
 * pattern already accepted three letters, but only two-letter codes were
 * recognised — every `.eng.` file fell through to the Turkish fallback below
 * and was imported, labelled and defaulted as Turkish.
 */
const ISO_639_2_TO_1: Record<string, string> = {
  tur: 'tr',
  eng: 'en',
  ger: 'de',
  deu: 'de',
  fre: 'fr',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  rus: 'ru',
  ara: 'ar',
  jpn: 'ja',
  kor: 'ko',
  chi: 'zh',
  zho: 'zh',
};

/** Used when the filename carries no language at all. */
export const UNKNOWN_LANGUAGE_CODE = 'und';

export function parseSubtitleFilename(filename: string): ParsedSubtitleInfo {
  const lower = filename.toLowerCase();
  const sourceFormat: 'vtt' | 'srt' = lower.endsWith('.srt') ? 'srt' : 'vtt';

  const forced = lower.includes('.forced.') || lower.includes('_forced.');
  const hearingImpaired =
    lower.includes('.sdh.') || lower.includes('_sdh.') || lower.includes('.hi.');

  const langMatch =
    lower.match(/\.([a-z]{2,3})\.(vtt|srt)$/i) || lower.match(/[\._\-]([a-z]{2,3})[\._\-]/i);

  const rawLang = langMatch?.[1]?.toLowerCase();
  const normalized = rawLang ? ISO_639_2_TO_1[rawLang] || rawLang : undefined;

  // An unrecognised or absent code stays unrecognised. It used to become `tr`,
  // which silently relabelled every foreign track as Turkish and — because the
  // default flag keys off `tr` — promoted it to the default subtitle.
  const languageCode = normalized || UNKNOWN_LANGUAGE_CODE;
  const baseLabel = LANGUAGE_LABELS[languageCode] || languageCode.toUpperCase();

  let languageLabel = baseLabel;
  if (forced && hearingImpaired) {
    languageLabel = `${baseLabel} — Forced (SDH)`;
  } else if (forced) {
    languageLabel = `${baseLabel} — Forced`;
  } else if (hearingImpaired) {
    languageLabel = `${baseLabel} — SDH`;
  }

  const isDefault = languageCode === 'tr' && !forced && !hearingImpaired;

  return {
    languageCode,
    languageLabel,
    forced,
    hearingImpaired,
    isDefault,
    sourceFormat,
  };
}

export function convertSrtToVtt(srtContent: string): string {
  if (!srtContent) return 'WEBVTT\n\n';

  // 1. Strip UTF-8 BOM if present
  let clean = srtContent.replace(/^\uFEFF/, '');

  // 2. Normalize Windows/Mac line endings to standard LF (\n)
  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Convert timestamp commas to dots (00:01:10,500 --> 00:01:13,000 or 01:10,500 --> 01:13,000)
  clean = clean.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4',
  );

  clean = clean.replace(/(\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}),(\d{3})/g, '$1.$2 --> $3.$4');

  // 4. Preserve a small WebVTT emphasis allowlist and discard active or
  // embedded markup without relying on bypass-prone replacement regexes.
  clean = sanitizeWebVttMarkup(clean);

  // Prepend WEBVTT header if not already present
  if (!clean.trim().startsWith('WEBVTT')) {
    clean = `WEBVTT\n\n${clean.trim()}`;
  }

  return clean;
}
import { sanitizeWebVttMarkup } from './html-text';

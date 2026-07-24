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

export function parseSubtitleFilename(filename: string): ParsedSubtitleInfo {
  const lower = filename.toLowerCase();
  const sourceFormat: 'vtt' | 'srt' = lower.endsWith('.srt') ? 'srt' : 'vtt';

  const forced = lower.includes('.forced.') || lower.includes('_forced.');
  const hearingImpaired =
    lower.includes('.sdh.') || lower.includes('_sdh.') || lower.includes('.hi.');

  const langMatch = lower.match(/\.([a-z]{2,3})\.(vtt|srt)$/i) ||
    lower.match(/[\._\-]([a-z]{2,3})[\._\-]/i);

  const rawLang = langMatch?.[1]?.toLowerCase() || 'tr';
  const languageCode = LANGUAGE_LABELS[rawLang] ? rawLang : 'tr';
  const baseLabel = LANGUAGE_LABELS[languageCode] || 'Türkçe';

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

  // 3. Convert timestamp commas to dots (e.g. 00:01:10,500 --> 00:01:13,000)
  clean = clean.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4',
  );

  // 4. Sanitize potentially dangerous HTML tags while preserving standard subtitle formatting (b, i, u, v, font)
  clean = clean.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '');
  clean = clean.replace(/<iframe\b[^<]*>([\s\S]*?)<\/iframe>/gi, '');

  // Prepend WEBVTT header if not already present
  if (!clean.trim().startsWith('WEBVTT')) {
    clean = `WEBVTT\n\n${clean.trim()}`;
  }

  return clean;
}

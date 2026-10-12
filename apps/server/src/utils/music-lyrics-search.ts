/** Fold Turkish dotted/dotless I as well as accents, without dropping other scripts. */
export const normalizeLyricsSearch = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const lyricsSearchExpression = (query: string): string | null => {
  if (query.length > 200) return null;
  const normalized = normalizeLyricsSearch(query);
  if (normalized.length < 3) return null;
  const tokens = [...new Set(normalized.split(' '))];
  if (tokens.length > 12) return null;
  // Only normalized literal words reach MATCH; operators/quotes are never syntax.
  return tokens.map((token) => `"${token}"*`).join(' AND ');
};

export const lyricsExcerpt = (lines: string[], query: string): string => {
  const tokens = normalizeLyricsSearch(query).split(' ').filter(Boolean);
  let best = '';
  let bestScore = -1;
  for (const line of lines) {
    const normalized = normalizeLyricsSearch(line);
    const score = tokens.filter((token) => normalized.includes(token)).length;
    if (score > bestScore) {
      best = line.trim();
      bestScore = score;
    }
  }
  // Bound wire/UI size by Unicode characters, not a possibly broken surrogate.
  const chars = Array.from(best);
  if (chars.length <= 180) return best;
  // Keep the matching word visible even in a long prose line.
  let start = 0;
  for (let offset = 0; offset < chars.length; offset += 80) {
    if (
      tokens.some((token) =>
        normalizeLyricsSearch(chars.slice(offset, offset + 180).join('')).includes(token),
      )
    ) {
      start = offset;
      break;
    }
  }
  return `${start ? '…' : ''}${chars.slice(start, start + 180).join('')}${start + 180 < chars.length ? '…' : ''}`;
};

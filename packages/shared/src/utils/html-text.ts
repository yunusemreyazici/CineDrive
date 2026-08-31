const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
};

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

const WEBVTT_FORMATTING_TAGS = new Set(['b', 'i', 'rt', 'ruby', 'u']);
const BLOCKED_CONTENT_TAGS = new Set([
  'embed',
  'iframe',
  'math',
  'object',
  'script',
  'style',
  'svg',
]);

const tagName = (token: string): string => {
  let index = 0;
  while (index < token.length && /[\s/]/.test(token[index] ?? '')) index += 1;
  const start = index;
  while (index < token.length && /[a-z0-9]/i.test(token[index] ?? '')) index += 1;
  return token.slice(start, index).toLowerCase();
};

const looksLikeTagStart = (value: string, index: number): boolean => {
  const next = value[index + 1] ?? '';
  if (/[a-z!?]/i.test(next)) return true;
  return next === '/' && /[a-z]/i.test(value[index + 2] ?? '');
};

export const decodeHtmlEntitiesOnce = (value: string): string =>
  value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hexadecimal, named) => {
    if (decimal || hexadecimal) {
      const codePoint = Number.parseInt(decimal || hexadecimal, hexadecimal ? 16 : 10);
      if (Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return NAMED_ENTITIES[String(named).toLowerCase()] ?? entity;
  });

export interface HtmlToPlainTextOptions {
  preserveLineBreaks?: boolean;
}

/**
 * Converts untrusted, small HTML fragments from metadata providers into text.
 * Markup is removed by a character scanner rather than a replacement regex so
 * nested or malformed tags cannot re-form after sanitization.
 */
export const htmlToPlainText = (value: string, options: HtmlToPlainTextOptions = {}): string => {
  const decoded = decodeHtmlEntitiesOnce(value);
  let output = '';
  let index = 0;
  const blockedStack: string[] = [];

  while (index < decoded.length) {
    if (decoded[index] !== '<') {
      if (blockedStack.length === 0) output += decoded[index];
      index += 1;
      continue;
    }

    if (!looksLikeTagStart(decoded, index)) {
      if (blockedStack.length === 0) output += '<';
      index += 1;
      continue;
    }

    if (decoded.startsWith('<!--', index)) {
      const commentEnd = decoded.indexOf('-->', index + 4);
      index = commentEnd === -1 ? decoded.length : commentEnd + 3;
      continue;
    }

    const end = decoded.indexOf('>', index + 1);
    if (end === -1) {
      // An incomplete tag is discarded instead of being passed to a future
      // HTML-rendering context as markup.
      break;
    }
    const token = decoded.slice(index + 1, end);
    const name = tagName(token);
    const closing = /^\s*\//.test(token);
    if (BLOCKED_CONTENT_TAGS.has(name)) {
      if (closing) {
        const matchingIndex = blockedStack.lastIndexOf(name);
        if (matchingIndex !== -1) blockedStack.splice(matchingIndex);
      } else {
        // HTML ignores the self-closing slash on elements such as <script/>.
        // Treat every opening form as blocked until its matching close tag.
        blockedStack.push(name);
      }
    } else if (blockedStack.length === 0 && BLOCK_TAGS.has(name) && output && !/\s$/.test(output)) {
      output += ' ';
    }
    index = end + 1;
  }

  return options.preserveLineBreaks
    ? output.replace(/[\t\f\v ]+/g, ' ').trim()
    : output.replace(/\s+/g, ' ').trim();
};

/**
 * Keeps only WebVTT's harmless emphasis tags and removes the complete content
 * of active/embedded elements. Attributes are never copied to the result.
 */
export const sanitizeWebVttMarkup = (value: string): string => {
  let output = '';
  let index = 0;
  const blockedStack: string[] = [];

  while (index < value.length) {
    if (value[index] !== '<') {
      if (blockedStack.length === 0) output += value[index];
      index += 1;
      continue;
    }

    if (!looksLikeTagStart(value, index)) {
      if (blockedStack.length === 0) output += '&lt;';
      index += 1;
      continue;
    }

    if (value.startsWith('<!--', index)) {
      const commentEnd = value.indexOf('-->', index + 4);
      index = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }

    const end = value.indexOf('>', index + 1);
    if (end === -1) {
      if (blockedStack.length === 0) output += '&lt;';
      index += 1;
      continue;
    }

    const token = value.slice(index + 1, end);
    const name = tagName(token);
    const closing = /^\s*\//.test(token);
    if (BLOCKED_CONTENT_TAGS.has(name)) {
      if (closing) {
        const matchingIndex = blockedStack.lastIndexOf(name);
        if (matchingIndex !== -1) blockedStack.splice(matchingIndex);
      } else {
        blockedStack.push(name);
      }
      index = end + 1;
      continue;
    }

    if (blockedStack.length === 0 && WEBVTT_FORMATTING_TAGS.has(name)) {
      output += `<${closing ? '/' : ''}${name}>`;
    }
    index = end + 1;
  }

  return output;
};

import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntitiesOnce,
  htmlToPlainText,
  sanitizeWebVttMarkup,
} from '../src/utils/html-text';

describe('untrusted markup handling', () => {
  it('decodes named and numeric entities exactly once', () => {
    expect(decodeHtmlEntitiesOnce('&lt;b&gt;Tom &amp; Jerry&#33;')).toBe('<b>Tom & Jerry!');
    expect(decodeHtmlEntitiesOnce('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('converts provider HTML to plain text and removes active-element content', () => {
    expect(
      htmlToPlainText(
        '<p>Hello&nbsp;<b>world</b></p><script><script>alert(1)</script></script><p>Again</p>',
      ),
    ).toBe('Hello world Again');
    expect(htmlToPlainText('&lt;img src=x onerror=alert(1)&gt;Safe')).toBe('Safe');
    expect(htmlToPlainText('<script/>hidden')).toBe('');
  });

  it('can preserve subtitle line breaks while stripping markup', () => {
    expect(htmlToPlainText('<i>first</i>\n2 < 3 and 5 > 4', { preserveLineBreaks: true })).toBe(
      'first\n2 < 3 and 5 > 4',
    );
  });

  it('normalizes WebVTT markup to a small allowlist', () => {
    expect(
      sanitizeWebVttMarkup(
        '<i class="ignored">safe</i><script src=x>hidden</script><svg>hidden</svg><font>text</font>',
      ),
    ).toBe('<i>safe</i>text');
    expect(sanitizeWebVttMarkup('&lt;script&gt;shown as text&lt;/script&gt;')).toBe(
      '&lt;script&gt;shown as text&lt;/script&gt;',
    );
    expect(sanitizeWebVttMarkup('2 < 3 and 5 > 4')).toBe('2 &lt; 3 and 5 > 4');
    expect(sanitizeWebVttMarkup('<script/>hidden')).toBe('');
  });
});

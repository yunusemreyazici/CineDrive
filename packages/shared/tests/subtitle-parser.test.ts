import { describe, it, expect } from 'vitest';
import { parseSubtitleFilename, convertSrtToVtt } from '../src/utils/subtitle-parser';

describe('Subtitle Parser & SRT Converter Unit Tests', () => {
  describe('parseSubtitleFilename', () => {
    it('should parse Turkish VTT subtitle filename e.g. "Inception.2010.tr.vtt"', () => {
      const parsed = parseSubtitleFilename('Inception.2010.tr.vtt');
      expect(parsed.languageCode).toBe('tr');
      expect(parsed.languageLabel).toBe('Türkçe');
      expect(parsed.forced).toBe(false);
      expect(parsed.hearingImpaired).toBe(false);
      expect(parsed.sourceFormat).toBe('vtt');
    });

    it('should parse English SRT subtitle filename e.g. "Movie.en.srt"', () => {
      const parsed = parseSubtitleFilename('Movie.en.srt');
      expect(parsed.languageCode).toBe('en');
      expect(parsed.languageLabel).toBe('English');
      expect(parsed.sourceFormat).toBe('srt');
    });

    it('resolves three-letter ISO 639-2 codes instead of falling back to Turkish', () => {
      // `.eng.` is at least as common as `.en.` in release naming, and it used
      // to be imported, labelled and defaulted as Turkish.
      const english = parseSubtitleFilename('Movie.2019.eng.srt');
      expect(english.languageCode).toBe('en');
      expect(english.languageLabel).toBe('English');
      expect(english.isDefault).toBe(false);

      expect(parseSubtitleFilename('Movie.ger.srt').languageCode).toBe('de');
      expect(parseSubtitleFilename('Movie.tur.srt').languageCode).toBe('tr');
    });

    it('marks a subtitle with no language in its name as undetermined, not Turkish', () => {
      const parsed = parseSubtitleFilename('Movie.srt');
      expect(parsed.languageCode).toBe('und');
      expect(parsed.isDefault).toBe(false);
    });

    it('should detect forced and SDH subtitles e.g. "Series.S01E01.forced.tr.vtt" & "Series.S01E01.sdh.en.srt"', () => {
      const forcedSub = parseSubtitleFilename('Series.S01E01.forced.tr.vtt');
      expect(forcedSub.forced).toBe(true);
      expect(forcedSub.languageLabel).toContain('Forced');

      const sdhSub = parseSubtitleFilename('Series.S01E01.sdh.en.srt');
      expect(sdhSub.hearingImpaired).toBe(true);
      expect(sdhSub.languageLabel).toContain('SDH');
    });
  });

  describe('convertSrtToVtt', () => {
    it('should convert comma timestamps to dot timestamps and prepend WEBVTT header', () => {
      const srt = `1
00:01:10,500 --> 00:01:13,000
Merhaba dünya!
`;

      const vtt = convertSrtToVtt(srt);
      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('00:01:10.500 --> 00:01:13.000');
      expect(vtt).toContain('Merhaba dünya!');
    });

    it('should strip UTF-8 BOM and normalize Windows line endings', () => {
      const srtWithBom = `\uFEFF1\r\n00:00:05,100 --> 00:00:08,200\r\nTest subtitle`;
      const vtt = convertSrtToVtt(srtWithBom);
      expect(vtt).not.toContain('\uFEFF');
      expect(vtt).not.toContain('\r\n');
      expect(vtt).toContain('00:00:05.100 --> 00:00:08.200');
    });

    it('should preserve Turkish characters cleanly', () => {
      const srt = `1
00:00:01,000 --> 00:00:04,000
Çalışan ğöşü ÇĞİÖŞÜ metin.
`;
      const vtt = convertSrtToVtt(srt);
      expect(vtt).toContain('Çalışan ğöşü ÇĞİÖŞÜ metin.');
    });

    it('should sanitize script tags for XSS protection', () => {
      const maliciousSrt = `1
00:00:01,000 --> 00:00:04,000
Normal text <script>alert("xss")</script> after.
`;
      const vtt = convertSrtToVtt(maliciousSrt);
      expect(vtt).not.toContain('<script>');
      expect(vtt).not.toContain('alert("xss")');
    });
  });
});

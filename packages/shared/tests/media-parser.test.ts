import { describe, it, expect } from 'vitest';
import { parseMediaFilename } from '../src/utils/media-parser';

describe('parseMediaFilename Comprehensive Tests', () => {
  describe('Movie Parsing', () => {
    it('should parse year in parentheses e.g. "Inception (2010).mp4"', () => {
      const result = parseMediaFilename('Inception (2010).mp4');
      expect(result).toEqual({
        type: 'movie',
        title: 'Inception',
        normalizedTitle: 'inception',
        year: 2010,
      });
    });

    it('should parse year with dots e.g. "Movie.Name.2025.1080p.mkv"', () => {
      const result = parseMediaFilename('Movie.Name.2025.1080p.mkv');
      expect(result).toEqual({
        type: 'movie',
        title: 'Movie Name',
        normalizedTitle: 'movie name',
        year: 2025,
      });
    });

    it('should parse year in brackets e.g. "Movie Name [2025].mp4"', () => {
      const result = parseMediaFilename('Movie Name [2025].mp4');
      expect(result).toEqual({
        type: 'movie',
        title: 'Movie Name',
        normalizedTitle: 'movie name',
        year: 2025,
      });
    });

    it('should clean technical tags (1080p, 2160p, 4K, WEB-DL, WEBRip, BluRay, HDR, DV, x264, x265, HEVC, AAC, DTS, DDP5.1, MULTI, REPACK)', () => {
      const result = parseMediaFilename(
        'The.Matrix.1999.2160p.4K.WEB-DL.BluRay.HDR.DV.x265.HEVC.DTS.DDP5.1.MULTI.REPACK.mkv',
      );
      expect(result.type).toBe('movie');
      expect(result.title).toBe('The Matrix');
      expect(result.year).toBe(1999);
    });
  });

  describe('Series & Episode Parsing', () => {
    it('should parse S01E01 pattern', () => {
      const result = parseMediaFilename('Severance.S01E01.mp4');
      expect(result).toEqual({
        type: 'series',
        title: 'Severance',
        normalizedTitle: 'severance',
        seasonNumber: 1,
        episodeNumber: 1,
      });
    });

    it('should parse lowercase s01e01 pattern', () => {
      const result = parseMediaFilename('severance.s02e05.1080p.mkv');
      expect(result).toEqual({
        type: 'series',
        title: 'severance',
        normalizedTitle: 'severance',
        seasonNumber: 2,
        episodeNumber: 5,
      });
    });

    it('should parse 1x01 pattern', () => {
      const result = parseMediaFilename('Game of Thrones 1x01 Winter Is Coming.mkv');
      expect(result).toEqual({
        type: 'series',
        title: 'Game of Thrones',
        normalizedTitle: 'game of thrones',
        seasonNumber: 1,
        episodeNumber: 1,
      });
    });

    it('should parse "Season 1 Episode 1" pattern', () => {
      const result = parseMediaFilename('Breaking Bad Season 2 Episode 3.mkv');
      expect(result).toEqual({
        type: 'series',
        title: 'Breaking Bad',
        normalizedTitle: 'breaking bad',
        seasonNumber: 2,
        episodeNumber: 3,
      });
    });

    it('should parse Turkish "Sezon 1 Bölüm 1" pattern', () => {
      const result = parseMediaFilename('Gibi Sezon 3 Bölüm 5.mp4');
      expect(result).toEqual({
        type: 'series',
        title: 'Gibi',
        normalizedTitle: 'gibi',
        seasonNumber: 3,
        episodeNumber: 5,
      });
    });
  });
});

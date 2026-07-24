import { describe, it, expect } from 'vitest';
import { parseMediaFilename } from '../src/utils/media-parser';

describe('parseMediaFilename', () => {
  it('should correctly parse movie filename with year in parentheses', () => {
    const result = parseMediaFilename('Inception (2010).mp4');
    expect(result).toEqual({
      type: 'movie',
      title: 'Inception',
      normalizedTitle: 'inception',
      year: 2010,
    });
  });

  it('should clean technical tags from movie filename', () => {
    const result = parseMediaFilename('Inception.2010.1080p.WEB-DL.x264.AAC.mp4');
    expect(result.type).toEqual('movie');
    expect(result.title).toEqual('Inception');
    expect(result.year).toEqual(2010);
  });

  it('should parse series episode S01E01 pattern', () => {
    const result = parseMediaFilename('Severance.S01E01.1080p.WEBRip.mp4');
    expect(result).toEqual({
      type: 'series',
      title: 'Severance',
      normalizedTitle: 'severance',
      seasonNumber: 1,
      episodeNumber: 1,
    });
  });

  it('should parse series episode 1x02 pattern', () => {
    const result = parseMediaFilename('Severance.1x02.mp4');
    expect(result).toEqual({
      type: 'series',
      title: 'Severance',
      normalizedTitle: 'severance',
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });

  it('should parse verbose Turkish season and episode pattern', () => {
    const result = parseMediaFilename('Severance Sezon 2 Bölüm 3.mkv');
    expect(result).toEqual({
      type: 'series',
      title: 'Severance',
      normalizedTitle: 'severance',
      seasonNumber: 2,
      episodeNumber: 3,
    });
  });
});

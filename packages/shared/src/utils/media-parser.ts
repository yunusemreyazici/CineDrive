export interface ParsedMediaInfo {
  type: 'movie' | 'series';
  title: string;
  normalizedTitle: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

const CLEANUP_TAGS_REGEX = /\b(1080p|2160p|4[kK]|WEB-?DL|WEBRip|BluRay|HDR|DV|x264|x265|HEVC|AAC|DTS|DDP5\.1|MULTI|REPACK|REMUX|PROPER|HDTV|UNRATED|EXTENDED)\b/gi;

export function parseMediaFilename(filename: string): ParsedMediaInfo {
  // 1. Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // 2. Normalize dots and underscores to spaces for tag matching
  let cleanName = nameWithoutExt.replace(/[._]/g, ' ').trim();

  // 3. Check for series episode patterns:
  // Pattern 1: S01E01 or s01e01
  const s00e00Match = cleanName.match(/(?:S|s)(\d{1,2})(?:E|e)(\d{1,2})/);
  // Pattern 2: 1x01 or 01x01
  const nxnMatch = cleanName.match(/\b(\d{1,2})x(\d{1,2})\b/i);
  // Pattern 3: Season 1 Episode 1 or Sezon 1 Bölüm 1
  const verboseMatch = cleanName.match(/(?:Season|Sezon)\s*(\d{1,2})\s*(?:Episode|Bölüm)\s*(\d{1,2})/i);

  const episodeMatch = s00e00Match || nxnMatch || verboseMatch;

  if (episodeMatch && episodeMatch[1] && episodeMatch[2]) {
    const seasonNumber = parseInt(episodeMatch[1], 10);
    const episodeNumber = parseInt(episodeMatch[2], 10);

    // Extract title before the episode tag
    const episodeTagIndex = episodeMatch.index ?? 0;
    let seriesTitle = cleanName.substring(0, episodeTagIndex).trim();

    // Clean tags from title
    seriesTitle = seriesTitle.replace(CLEANUP_TAGS_REGEX, '').replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();

    return {
      type: 'series',
      title: seriesTitle || 'Unknown Series',
      normalizedTitle: (seriesTitle || 'Unknown Series').toLowerCase(),
      seasonNumber,
      episodeNumber,
    };
  }

  // 4. Check for movie year patterns: (2025), [2025], .2025. or 2025
  const yearMatch = cleanName.match(/(?:\(|\[|\s|^)(\d{4})(?:\)|\]|\s|$)/);
  let year: number | undefined;

  let movieTitle = cleanName;
  if (yearMatch && yearMatch[1]) {
    const parsedYear = parseInt(yearMatch[1], 10);
    if (parsedYear >= 1900 && parsedYear <= 2100) {
      year = parsedYear;
      const yearIndex = yearMatch.index ?? 0;
      movieTitle = cleanName.substring(0, yearIndex).trim();
    }
  }

  // Clean tags from movie title
  movieTitle = movieTitle.replace(CLEANUP_TAGS_REGEX, '').replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    type: 'movie',
    title: movieTitle || cleanName,
    normalizedTitle: (movieTitle || cleanName).toLowerCase(),
    year,
  };
}

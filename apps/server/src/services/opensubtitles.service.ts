import { convertSrtToVtt } from '@cinedrive/shared';

export interface OpenSubtitlesSearchResult {
  id: string;
  filename: string;
  languageName: string;
  languageCode: string;
  downloadUrl: string;
  format: string;
  score: number;
  releaseName?: string;
}

export class OpenSubtitlesService {
  /**
   * Searches OpenSubtitles for subtitles matching title, season, and episode
   */
  public async searchSubtitles(
    title: string,
    seasonNumber?: number,
    episodeNumber?: number,
    languages: string[] = ['tur', 'eng'],
  ): Promise<OpenSubtitlesSearchResult[]> {
    try {
      const cleanTitle = title
        .replace(/\b(19|20)\d{2}\b/g, '')
        .replace(/[._\-]/g, ' ')
        .trim();

      let queryStr = cleanTitle;
      if (seasonNumber !== undefined && episodeNumber !== undefined) {
        const s = seasonNumber < 10 ? `0${seasonNumber}` : `${seasonNumber}`;
        const e = episodeNumber < 10 ? `0${episodeNumber}` : `${episodeNumber}`;
        queryStr += ` S${s}E${e}`;
      }

      const langPath = languages.join(',');
      const url = `https://rest.opensubtitles.org/user-agent/temporary/search/query-${encodeURIComponent(queryStr)}/sublanguageid-${langPath}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'TemporaryUserAgent',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        return [];
      }

      const data = (await res.json()) as Array<{
        IDSubtitleFile?: string;
        SubFileName?: string;
        LanguageName?: string;
        ISO639?: string;
        SubDownloadLink?: string;
        SubFormat?: string;
        Score?: string | number;
        MovieReleaseName?: string;
      }>;

      if (!Array.isArray(data)) {
        return [];
      }

      return data
        .filter((item) => !!item.SubDownloadLink)
        .slice(0, 15)
        .map((item) => ({
          id: item.IDSubtitleFile || item.SubDownloadLink || Math.random().toString(),
          filename: item.SubFileName || item.MovieReleaseName || 'Altyazı',
          languageName: item.LanguageName || 'Türkçe',
          languageCode: item.ISO639 || 'tr',
          downloadUrl: item.SubDownloadLink || '',
          format: item.SubFormat || 'srt',
          score: item.Score ? Number(item.Score) : 0,
          releaseName: item.MovieReleaseName,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Downloads .srt file from OpenSubtitles and converts to WebVTT format
   */
  public async downloadAndConvertSubtitle(downloadUrl: string): Promise<string> {
    const res = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'TemporaryUserAgent',
      },
    });

    if (!res.ok) {
      throw new Error('SUBTITLE_DOWNLOAD_FAILED');
    }

    const srtText = await res.text();
    return convertSrtToVtt(srtText);
  }
}

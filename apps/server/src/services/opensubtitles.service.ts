import { convertSrtToVtt } from '@cinedrive/shared';

export interface OpenSubtitlesSearchResult {
  id: string;
  fileId: number;
  filename: string;
  languageName: string;
  languageCode: string;
  downloadCount: number;
  releaseName?: string;
}

export class OpenSubtitlesService {
  /**
   * Searches OpenSubtitles v1 API for subtitles matching title, season, and episode
   */
  public async searchSubtitles(
    title: string,
    seasonNumber?: number,
    episodeNumber?: number,
    languages: string[] = ['tr', 'en'],
    apiKey?: string,
  ): Promise<{ results: OpenSubtitlesSearchResult[]; message?: string }> {
    try {
      const activeApiKey = apiKey || process.env.OPENSUBTITLES_API_KEY;

      if (!activeApiKey) {
        return {
          results: [],
          message: 'NO_API_KEY',
        };
      }

      const cleanTitle = title
        .replace(/\b(19|20)\d{2}\b/g, '')
        .replace(/[._\-]/g, ' ')
        .trim();

      let url = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(cleanTitle)}&languages=${languages.join(',')}`;

      if (seasonNumber !== undefined && episodeNumber !== undefined) {
        url += `&season_number=${seasonNumber}&episode_number=${episodeNumber}`;
      }

      const res = await fetch(url, {
        headers: {
          'Api-Key': activeApiKey,
          'User-Agent': 'CineDrive v1.0',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { results: [], message: 'INVALID_API_KEY' };
        }
        return { results: [], message: 'API_ERROR' };
      }

      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          attributes?: {
            language?: string;
            release?: string;
            download_count?: number;
            files?: Array<{
              file_id: number;
              file_name: string;
            }>;
          };
        }>;
      };

      if (!data.data || !Array.isArray(data.data)) {
        return { results: [] };
      }

      const results: OpenSubtitlesSearchResult[] = [];

      for (const item of data.data) {
        const file = item.attributes?.files?.[0];
        if (file && file.file_id) {
          results.push({
            id: String(file.file_id),
            fileId: file.file_id,
            filename: file.file_name || item.attributes?.release || 'Altyazı',
            languageName: item.attributes?.language === 'tr' ? 'Türkçe' : item.attributes?.language === 'en' ? 'İngilizce' : (item.attributes?.language || 'Türkçe'),
            languageCode: item.attributes?.language || 'tr',
            downloadCount: item.attributes?.download_count || 0,
            releaseName: item.attributes?.release,
          });
        }
      }

      return { results: results.slice(0, 15) };
    } catch {
      return { results: [], message: 'SEARCH_FAILED' };
    }
  }

  /**
   * Downloads subtitle file from OpenSubtitles v1 API by fileId and converts to WebVTT format
   */
  public async downloadAndConvertSubtitle(fileId: number | string, apiKey?: string): Promise<string> {
    const activeApiKey = apiKey || process.env.OPENSUBTITLES_API_KEY;

    if (!activeApiKey) {
      throw new Error('NO_API_KEY');
    }

    const res = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: {
        'Api-Key': activeApiKey,
        'User-Agent': 'CineDrive v1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ file_id: Number(fileId) }),
    });

    if (!res.ok) {
      throw new Error('SUBTITLE_DOWNLOAD_FAILED');
    }

    const data = (await res.json()) as { link?: string };

    if (!data.link) {
      throw new Error('SUBTITLE_LINK_MISSING');
    }

    const fileRes = await fetch(data.link, {
      headers: {
        'User-Agent': 'CineDrive v1.0',
      },
    });

    if (!fileRes.ok) {
      throw new Error('SUBTITLE_FILE_FETCH_FAILED');
    }

    const srtText = await fileRes.text();
    return convertSrtToVtt(srtText);
  }
}

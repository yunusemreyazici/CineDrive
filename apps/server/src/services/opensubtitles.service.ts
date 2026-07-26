import { convertSrtToVtt } from '@cinedrive/shared';
import { decodeSubtitleBytes } from '../utils/subtitle-encoding.js';

const API_BASE_URL = 'https://api.opensubtitles.com/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SUBTITLE_SIZE_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'CineDrive v1.0';

export interface OpenSubtitlesSearchResult {
  id: string;
  fileId: number;
  filename: string;
  languageName: string;
  languageCode: string;
  downloadCount: number;
  releaseName?: string;
}

export interface OpenSubtitlesSearchIdentifiers {
  tmdbId?: number | null;
  imdbId?: string | null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  tr: 'Türkçe',
  en: 'İngilizce',
  de: 'Almanca',
  fr: 'Fransızca',
  es: 'İspanyolca',
  it: 'İtalyanca',
};

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
    identifiers: OpenSubtitlesSearchIdentifiers = {},
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
        .replace(/\s+/g, ' ')
        .trim();

      const normalizedLanguages = [
        ...new Set(
          languages
            .map((language) => language.trim().toLowerCase())
            .filter((language) => /^[a-z]{2,3}$/.test(language)),
        ),
      ];
      const params = new URLSearchParams({
        languages: (normalizedLanguages.length ? normalizedLanguages : ['tr', 'en']).join(','),
      });
      const normalizedImdbId = identifiers.imdbId?.replace(/^tt/i, '').trim();

      if (Number.isSafeInteger(identifiers.tmdbId) && Number(identifiers.tmdbId) > 0) {
        params.set('tmdb_id', String(identifiers.tmdbId));
      } else if (normalizedImdbId && /^\d+$/.test(normalizedImdbId)) {
        params.set('imdb_id', normalizedImdbId);
      } else {
        params.set('query', cleanTitle);
      }

      if (
        Number.isInteger(seasonNumber) &&
        Number.isInteger(episodeNumber) &&
        seasonNumber! >= 0 &&
        episodeNumber! > 0
      ) {
        params.set('season_number', String(seasonNumber));
        params.set('episode_number', String(episodeNumber));
      }

      const res = await fetch(`${API_BASE_URL}/subtitles?${params.toString()}`, {
        headers: {
          'Api-Key': activeApiKey,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { results: [], message: 'INVALID_API_KEY' };
        }
        if (res.status === 400 || res.status === 422) {
          return { results: [], message: 'INVALID_SEARCH' };
        }
        if (res.status === 429) {
          return { results: [], message: 'RATE_LIMITED' };
        }
        if (res.status >= 500) {
          return { results: [], message: 'SERVICE_UNAVAILABLE' };
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

      const seenFileIds = new Set<number>();
      for (const item of data.data) {
        for (const file of item.attributes?.files || []) {
          if (file.file_id > 0 && !seenFileIds.has(file.file_id)) {
            seenFileIds.add(file.file_id);
            results.push({
              id: String(file.file_id),
              fileId: file.file_id,
              filename: file.file_name || item.attributes?.release || 'Altyazı',
              // A language the map does not know is reported as itself, not
              // as Turkish: the old fallback stored French and Spanish tracks
              // with `languageCode: 'tr'`.
              languageName: LANGUAGE_NAMES[item.attributes?.language || ''] ||
                item.attributes?.language?.toUpperCase() ||
                'Bilinmiyor',
              languageCode: item.attributes?.language || 'und',
              downloadCount: item.attributes?.download_count || 0,
              releaseName: item.attributes?.release,
            });
          }
        }
      }

      return {
        results: results
          .sort((left, right) => right.downloadCount - left.downloadCount)
          .slice(0, 15),
      };
    } catch {
      return { results: [], message: 'SEARCH_FAILED' };
    }
  }

  /**
   * Downloads subtitle file from OpenSubtitles v1 API by fileId and converts to WebVTT format
   */
  public async downloadAndConvertSubtitle(
    fileId: number | string,
    apiKey?: string,
  ): Promise<string> {
    const activeApiKey = apiKey || process.env.OPENSUBTITLES_API_KEY;

    if (!activeApiKey) {
      throw new Error('NO_API_KEY');
    }

    const numericFileId = typeof fileId === 'number' ? fileId : Number(fileId);
    if (!Number.isSafeInteger(numericFileId) || numericFileId <= 0) {
      throw new Error('INVALID_SUBTITLE_FILE_ID');
    }

    const res = await fetch(`${API_BASE_URL}/download`, {
      method: 'POST',
      headers: {
        'Api-Key': activeApiKey,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ file_id: numericFileId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!fileRes.ok) {
      throw new Error('SUBTITLE_FILE_FETCH_FAILED');
    }

    const contentLength = Number(fileRes.headers.get('content-length') || 0);
    if (contentLength > MAX_SUBTITLE_SIZE_BYTES) {
      throw new Error('SUBTITLE_FILE_TOO_LARGE');
    }

    const subtitleBytes = new Uint8Array(await fileRes.arrayBuffer());
    if (subtitleBytes.byteLength > MAX_SUBTITLE_SIZE_BYTES) {
      throw new Error('SUBTITLE_FILE_TOO_LARGE');
    }
    const srtText = decodeSubtitleBytes(subtitleBytes);
    return convertSrtToVtt(srtText);
  }
}

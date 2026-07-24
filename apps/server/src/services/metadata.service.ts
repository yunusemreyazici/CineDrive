export interface OnlineMetadataResult {
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  year?: number;
}

export interface OnlineEpisodeMetadata {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string | null;
  stillUrl: string | null;
}

export class MetadataService {
  private episodeCache = new Map<string, Map<string, OnlineEpisodeMetadata>>();

  /**
   * Fetches episode titles, plots and thumbnail URLs for a TV series
   */
  public async fetchShowEpisodes(showTitle: string): Promise<Map<string, OnlineEpisodeMetadata>> {
    const cleanTitle = showTitle
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/[._\-]/g, ' ')
      .trim()
      .toLowerCase();

    if (this.episodeCache.has(cleanTitle)) {
      return this.episodeCache.get(cleanTitle)!;
    }

    const map = new Map<string, OnlineEpisodeMetadata>();
    try {
      const res = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}&embed=episodes`);
      if (res.ok) {
        const data = (await res.json()) as {
          _embedded?: {
            episodes?: Array<{
              season: number;
              number: number;
              name: string;
              summary?: string;
              image?: { original?: string; medium?: string };
            }>;
          };
        };

        const episodes = data._embedded?.episodes || [];
        for (const ep of episodes) {
          const key = `${ep.season}x${ep.number}`;
          map.set(key, {
            seasonNumber: ep.season,
            episodeNumber: ep.number,
            name: ep.name,
            overview: ep.summary ? ep.summary.replace(/<[^>]*>/g, '').trim() : null,
            stillUrl: ep.image?.original || ep.image?.medium || null,
          });
        }
      }
    } catch {
      // Ignore network errors
    }

    this.episodeCache.set(cleanTitle, map);
    return map;
  }

  /**
   * Fetches poster image URL, backdrop URL, overview and year automatically from open APIs
   */
  public async fetchMetadata(title: string, _type: 'movie' | 'series'): Promise<OnlineMetadataResult | null> {
    try {
      const cleanTitle = title
        .replace(/\b(19|20)\d{2}\b/g, '')
        .replace(/[._\-]/g, ' ')
        .trim();

      // Query TVMaze Open API (fast, free, no API key required)
      const res = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}`);
      if (res.ok) {
        const data = (await res.json()) as {
          name?: string;
          summary?: string;
          premiered?: string;
          image?: { original?: string; medium?: string };
        };

        const posterUrl = data.image?.original || data.image?.medium || null;
        const overview = data.summary ? data.summary.replace(/<[^>]*>/g, '').trim() : null;
        const year = data.premiered ? parseInt(data.premiered.substring(0, 4), 10) : undefined;

        if (posterUrl || overview) {
          return {
            posterUrl,
            backdropUrl: posterUrl,
            overview,
            year,
          };
        }
      }
    } catch {
      // Ignore network errors on fetch
    }

    return null;
  }
}

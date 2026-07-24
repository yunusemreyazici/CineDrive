export interface OnlineMetadataResult {
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  year?: number;
}

export class MetadataService {
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
        const data = await res.json() as {
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

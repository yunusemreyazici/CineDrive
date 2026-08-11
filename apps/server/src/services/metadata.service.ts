import { env } from '../config/env.js';

export interface CastMember {
  name: string;
  character?: string;
  profileUrl?: string;
}

export interface OnlineMetadataResult {
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  year?: number;
  voteAverage?: number;
  voteCount?: number;
  genres?: string[];
  cast?: CastMember[];
  trailerUrl?: string;
  contentRating?: string;
  tmdbId?: number;
  imdbId?: string;
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

  private resolveTmdbApiKey(userApiKey?: string): string | undefined {
    const key = userApiKey?.trim() || process.env.TMDB_API_KEY?.trim();
    if (!key || key === 'your_tmdb_api_key_here') return undefined;
    return key;
  }

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
      const res = await fetch(
        `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}&embed=episodes`,
        {
          signal: AbortSignal.timeout(5000),
        },
      );
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

    if (this.episodeCache.size > 100) {
      const firstKey = this.episodeCache.keys().next().value;
      if (firstKey) this.episodeCache.delete(firstKey);
    }
    this.episodeCache.set(cleanTitle, map);
    return map;
  }

  /**
   * Fetches poster image URL, backdrop URL, overview, year, ratings, genres, cast, and trailer automatically
   */
  public async fetchMetadata(
    title: string,
    type: 'movie' | 'series',
    userApiKey?: string,
  ): Promise<OnlineMetadataResult | null> {
    const apiKey = this.resolveTmdbApiKey(userApiKey);
    const cleanTitle = title
      .replace(/\b(19|20)\d{2}\b/g, '')
      .replace(/[._\-]/g, ' ')
      .trim();

    // 1. Try TMDB if API key is provided
    if (apiKey) {
      const tmdbResult = await this.fetchTmdbMetadata(cleanTitle, type, apiKey);
      if (tmdbResult) {
        return tmdbResult;
      }
    }

    // 2. Fallback to TVMaze API if TMDB fails or key is missing
    return this.fetchTvMazeMetadata(cleanTitle);
  }

  /**
   * TMDB API Fetcher for Movies and Series
   */
  private async fetchTmdbMetadata(
    cleanTitle: string,
    type: 'movie' | 'series',
    apiKey: string,
  ): Promise<OnlineMetadataResult | null> {
    try {
      const endpoint = type === 'movie' ? 'search/movie' : 'search/tv';
      const searchRes = await fetch(
        `https://api.themoviedb.org/3/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}&language=${env.METADATA_LANGUAGE}`,
        { signal: AbortSignal.timeout(5000) },
      );

      if (!searchRes.ok) return null;

      const searchData = (await searchRes.json()) as {
        results?: Array<{
          id: number;
          title?: string;
          name?: string;
          release_date?: string;
          first_air_date?: string;
          poster_path?: string;
          backdrop_path?: string;
          overview?: string;
          vote_average?: number;
          vote_count?: number;
        }>;
      };

      const match = searchData.results?.[0];
      if (!match) return null;

      // Fetch full details with append_to_response
      const detailEndpoint = type === 'movie' ? `movie/${match.id}` : `tv/${match.id}`;
      const appendParams =
        type === 'movie' ? 'videos,credits,release_dates' : 'videos,credits,content_ratings';
      const detailRes = await fetch(
        `https://api.themoviedb.org/3/${detailEndpoint}?api_key=${apiKey}&append_to_response=${appendParams}&language=${env.METADATA_LANGUAGE}`,
        { signal: AbortSignal.timeout(5000) },
      );

      if (!detailRes.ok) return null;

      const details = (await detailRes.json()) as {
        id: number;
        imdb_id?: string;
        genres?: Array<{ id: number; name: string }>;
        poster_path?: string;
        backdrop_path?: string;
        overview?: string;
        vote_average?: number;
        vote_count?: number;
        release_date?: string;
        first_air_date?: string;
        credits?: {
          cast?: Array<{
            name: string;
            character?: string;
            profile_path?: string;
          }>;
        };
        videos?: {
          results?: Array<{
            key: string;
            site: string;
            type: string;
          }>;
        };
        release_dates?: {
          results?: Array<{
            iso_3166_1: string;
            release_dates?: Array<{ certification?: string }>;
          }>;
        };
        content_ratings?: {
          results?: Array<{
            iso_3166_1: string;
            rating?: string;
          }>;
        };
      };

      const posterUrl = details.poster_path
        ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
        : null;
      const backdropUrl = details.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
        : posterUrl;

      const releaseDateStr =
        details.release_date ||
        details.first_air_date ||
        match.release_date ||
        match.first_air_date;
      const year = releaseDateStr ? parseInt(releaseDateStr.substring(0, 4), 10) : undefined;

      const genres = details.genres?.map((g) => g.name) || [];

      // Cast (top 10)
      const cast: CastMember[] = (details.credits?.cast || []).slice(0, 10).map((actor) => ({
        name: actor.name,
        character: actor.character || undefined,
        profileUrl: actor.profile_path
          ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
          : undefined,
      }));

      // Trailer
      const trailer = details.videos?.results?.find(
        (v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'),
      );
      const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : undefined;

      // Age Content Rating
      let contentRating: string | undefined;
      if (type === 'movie' && details.release_dates?.results) {
        const usRating = details.release_dates.results.find(
          (r) => r.iso_3166_1 === 'US' || r.iso_3166_1 === 'TR',
        );
        const cert = usRating?.release_dates?.find((d) => d.certification)?.certification;
        if (cert) contentRating = cert;
      } else if (type === 'series' && details.content_ratings?.results) {
        const ratingObj = details.content_ratings.results.find(
          (r) => r.iso_3166_1 === 'US' || r.iso_3166_1 === 'TR',
        );
        if (ratingObj?.rating) contentRating = ratingObj.rating;
      }

      return {
        posterUrl,
        backdropUrl,
        overview: details.overview || match.overview || null,
        year: isNaN(Number(year)) ? undefined : year,
        voteAverage: details.vote_average ? Math.round(details.vote_average * 10) / 10 : undefined,
        voteCount: details.vote_count || undefined,
        genres: genres.length > 0 ? genres : undefined,
        cast: cast.length > 0 ? cast : undefined,
        trailerUrl,
        contentRating,
        tmdbId: details.id,
        imdbId: details.imdb_id || undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * TVMaze API Fallback Fetcher
   */
  private async fetchTvMazeMetadata(cleanTitle: string): Promise<OnlineMetadataResult | null> {
    try {
      const res = await fetch(
        `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}`,
        {
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          name?: string;
          summary?: string;
          premiered?: string;
          genres?: string[];
          rating?: { average?: number };
          image?: { original?: string; medium?: string };
        };

        const posterUrl = data.image?.original || data.image?.medium || null;
        const overview = data.summary ? data.summary.replace(/<[^>]*>/g, '').trim() : null;
        const year = data.premiered ? parseInt(data.premiered.substring(0, 4), 10) : undefined;
        const voteAverage = data.rating?.average || undefined;
        const genres = data.genres || undefined;

        if (posterUrl || overview) {
          return {
            posterUrl,
            backdropUrl: posterUrl,
            overview,
            year,
            voteAverage,
            genres,
          };
        }
      }
    } catch {
      // Ignore network errors
    }

    return null;
  }
}

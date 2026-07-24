import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataService } from '../src/services/metadata.service';

describe('MetadataService', () => {
  let metadataService: MetadataService;
  const originalEnv = process.env;

  beforeEach(() => {
    metadataService = new MetadataService();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('fetchMetadata', () => {
    it('should fallback to TVMaze when TMDB_API_KEY is not configured', async () => {
      delete process.env.TMDB_API_KEY;

      const tvMazeResponse = {
        name: 'Inception',
        summary: '<p>A thief who steals corporate secrets.</p>',
        premiered: '2010-07-16',
        genres: ['Action', 'Sci-Fi'],
        rating: { average: 8.8 },
        image: { original: 'https://tvmaze.com/inception.jpg' },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('api.tvmaze.com')) {
          return new Response(JSON.stringify(tvMazeResponse), { status: 200 });
        }
        return new Response(null, { status: 404 });
      });

      const result = await metadataService.fetchMetadata('Inception 2010', 'movie');

      expect(result).not.toBeNull();
      expect(result?.posterUrl).toBe('https://tvmaze.com/inception.jpg');
      expect(result?.overview).toBe('A thief who steals corporate secrets.');
      expect(result?.year).toBe(2010);
      expect(result?.genres).toEqual(['Action', 'Sci-Fi']);
    });

    it('should fetch metadata from TMDB when TMDB_API_KEY is valid', async () => {
      process.env.TMDB_API_KEY = 'valid_test_api_key';

      const searchResponse = {
        results: [
          {
            id: 27205,
            title: 'Inception',
            release_date: '2010-07-15',
            poster_path: '/poster.jpg',
            backdrop_path: '/backdrop.jpg',
            overview: 'Dream within a dream.',
            vote_average: 8.4,
            vote_count: 35000,
          },
        ],
      };

      const detailResponse = {
        id: 27205,
        imdb_id: 'tt1375666',
        genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }],
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        overview: 'Dream within a dream.',
        vote_average: 8.36,
        vote_count: 35000,
        release_date: '2010-07-15',
        credits: {
          cast: [
            { name: 'Leonardo DiCaprio', character: 'Cobb', profile_path: '/leo.jpg' },
            { name: 'Joseph Gordon-Levitt', character: 'Arthur', profile_path: '/joseph.jpg' },
          ],
        },
        videos: {
          results: [
            { key: 'YoHD9XEInc0', site: 'YouTube', type: 'Trailer' },
          ],
        },
        release_dates: {
          results: [
            { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
          ],
        },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('search/movie')) {
          return new Response(JSON.stringify(searchResponse), { status: 200 });
        }
        if (urlStr.includes('movie/27205')) {
          return new Response(JSON.stringify(detailResponse), { status: 200 });
        }
        return new Response(null, { status: 404 });
      });

      const result = await metadataService.fetchMetadata('Inception', 'movie');

      expect(result).not.toBeNull();
      expect(result?.tmdbId).toBe(27205);
      expect(result?.imdbId).toBe('tt1375666');
      expect(result?.posterUrl).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
      expect(result?.backdropUrl).toBe('https://image.tmdb.org/t/p/w1280/backdrop.jpg');
      expect(result?.genres).toEqual(['Action', 'Science Fiction']);
      expect(result?.cast).toHaveLength(2);
      expect(result?.cast?.[0]).toEqual({
        name: 'Leonardo DiCaprio',
        character: 'Cobb',
        profileUrl: 'https://image.tmdb.org/t/p/w185/leo.jpg',
      });
      expect(result?.trailerUrl).toBe('https://www.youtube.com/watch?v=YoHD9XEInc0');
      expect(result?.contentRating).toBe('PG-13');
    });

    it('should return null when network requests throw error', async () => {
      delete process.env.TMDB_API_KEY;

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await metadataService.fetchMetadata('Unknown Movie', 'movie');
      expect(result).toBeNull();
    });
  });

  describe('fetchShowEpisodes', () => {
    it('should fetch and cache TV series episodes from TVMaze', async () => {
      const tvMazeEmbeddedResponse = {
        _embedded: {
          episodes: [
            {
              season: 1,
              number: 1,
              name: 'Pilot',
              summary: '<p>First episode summary.</p>',
              image: { original: 'https://tvmaze.com/s1e1.jpg' },
            },
          ],
        },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(tvMazeEmbeddedResponse), { status: 200 })
      );

      const episodesMap1 = await metadataService.fetchShowEpisodes('Breaking Bad');
      expect(episodesMap1.has('1x1')).toBe(true);
      expect(episodesMap1.get('1x1')).toEqual({
        seasonNumber: 1,
        episodeNumber: 1,
        name: 'Pilot',
        overview: 'First episode summary.',
        stillUrl: 'https://tvmaze.com/s1e1.jpg',
      });

      // Second call should return from cache without fetching again
      const episodesMap2 = await metadataService.fetchShowEpisodes('Breaking Bad');
      expect(episodesMap2).toBe(episodesMap1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});

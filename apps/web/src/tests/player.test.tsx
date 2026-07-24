import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaPlayer } from '../features/player/components/MediaPlayer';
import { ResumeOverlay } from '../features/player/components/ResumeOverlay';
import { NextEpisodeOverlay } from '../features/player/components/NextEpisodeOverlay';
import { PlayerError } from '../features/player/components/PlayerError';
import type { MediaItemType } from '../types/media';

describe('Player Components Unit Tests', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockMovie: MediaItemType = {
    id: 'media_movie_10',
    type: 'movie',
    title: 'Interstellar',
    normalizedTitle: 'interstellar',
    movie: {
      id: 'movie_10_inst',
      driveFileId: 'gdrive_interstellar_file',
    },
  };
  const mockSeries: MediaItemType = {
    id: 'media_series_test',
    type: 'series',
    title: 'Test Series',
    normalizedTitle: 'test-series',
    series: {
      id: 'series_test',
      seasons: [
        {
          id: 'season_test',
          seasonNumber: 1,
          episodes: [
            {
              id: 'episode_1',
              seasonNumber: 1,
              episodeNumber: 1,
              title: 'Episode 1',
              driveFileId: 'file_1',
            },
            {
              id: 'episode_2',
              seasonNumber: 1,
              episodeNumber: 2,
              title: 'Episode 2',
              driveFileId: 'file_2',
            },
          ],
        },
      ],
    },
  };

  it('renders ResumeOverlay with position time and handles choice', () => {
    const onResume = vi.fn();
    const onRestart = vi.fn();

    render(
      <ResumeOverlay
        savedPositionSeconds={1250}
        onResume={onResume}
        onRestart={onRestart}
      />,
    );

    expect(screen.getByText(/kaldığın yerden devam et/i)).toBeInTheDocument();
    expect(screen.getByText(/baştan başlat/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/baştan başlat/i));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('renders NextEpisodeOverlay with countdown and play next action', () => {
    const onPlayNext = vi.fn();
    const onCancel = vi.fn();

    render(
      <NextEpisodeOverlay
        nextEpisodeTitle="The Narrow Way"
        seasonNumber={1}
        episodeNumber={2}
        onPlayNext={onPlayNext}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('The Narrow Way')).toBeInTheDocument();
    expect(screen.getByText(/hemen oynat/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/hemen oynat/i));
    expect(onPlayNext).toHaveBeenCalledTimes(1);
  });

  it('renders PlayerError with unsupported codec message', () => {
    const onRetry = vi.fn();

    render(
      <PlayerError
        error={{
          code: 'CODEC_NOT_SUPPORTED',
          message: 'Unsupported format',
          isRetryable: false,
        }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/video biçimi desteklenmiyor/i)).toBeInTheDocument();
    expect(screen.getByText(/Ses\/Safari Uyum Modunu/i)).toBeInTheDocument();
  });

  it('renders MediaPlayer container with video stream URL', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Interstellar')).toBeInTheDocument();
  });

  it('keeps Safari on direct MP4 first and falls back to full transcode after a media error', () => {
    const userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      );

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream',
    );

    fireEvent.error(video!);

    expect(video?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/hls/index.m3u8',
    );
    expect(screen.queryByText('Oynatma Hatası')).not.toBeInTheDocument();

    userAgentSpy.mockRestore();
  });

  it('does not reopen the next episode overlay after the user dismisses it', () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockSeries} episodeId="episode_1" />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 95,
    });

    fireEvent.timeUpdate(video);
    expect(screen.getByText('Sonraki Bölüm')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText('Sonraki Bölüm')).not.toBeInTheDocument();

    fireEvent.timeUpdate(video);
    expect(screen.queryByText('Sonraki Bölüm')).not.toBeInTheDocument();
  });
});

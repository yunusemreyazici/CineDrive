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
      driveFileId: 'gdrive_interstellar_file',
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
    expect(screen.getByText(/H.264\/AAC içeren MP4 biçimine dönüştürmeniz gerekebilir/i)).toBeInTheDocument();
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
});

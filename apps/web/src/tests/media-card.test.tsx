import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaCard } from '../components/media/MediaCard';

describe('MediaCard Component', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockMovie = {
    id: 'media_movie_1',
    type: 'movie' as const,
    title: 'Inception',
    year: 2010,
    isFavorite: false,
    progress: { percentage: 45 },
  };

  it('renders title, year, badge and watch progress', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaCard media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const titleElements = screen.getAllByText('Inception');
    expect(titleElements.length).toBeGreaterThan(0);
    expect(screen.getByText('2010')).toBeInTheDocument();
    expect(screen.getByText('Film')).toBeInTheDocument();
  });
});

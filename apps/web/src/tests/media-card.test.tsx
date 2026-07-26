import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaCard } from '../components/media/MediaCard';
import type { MediaItemType } from '../types/media';
import { t } from '../i18n';

describe('MediaCard Component', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockMovie: MediaItemType = {
    id: 'media_movie_1',
    type: 'movie',
    title: 'Inception',
    normalizedTitle: 'inception',
    year: 2010,
    isFavorite: false,
    progress: {
      positionSeconds: 2700,
      durationSeconds: 6000,
      percentage: 45,
      completed: false,
    },
  };

  const renderCard = (media: MediaItemType = mockMovie) =>
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaCard media={media} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

  it('renders title, year, badge and watch progress', () => {
    renderCard();

    const titleElements = screen.getAllByText('Inception');
    expect(titleElements.length).toBeGreaterThan(0);
    expect(screen.getByText('2010')).toBeInTheDocument();
    expect(screen.getByText(t.common.movie)).toBeInTheDocument();
  });

  it('exposes the card as a keyboard-reachable link to the detail page', () => {
    renderCard();

    const detailLink = screen.getByRole('link', { name: t.mediaCard.openDetails(mockMovie.title) });
    expect(detailLink).toHaveAttribute('href', '/media/media_movie_1');
  });

  it('labels the action buttons with the media title', () => {
    renderCard();

    expect(screen.getByRole('button', { name: t.mediaCard.play(mockMovie.title) })).toBeInTheDocument();
    const favorite = screen.getByRole('button', { name: t.mediaCard.addFavorite(mockMovie.title) });
    expect(favorite).toHaveAttribute('aria-pressed', 'false');
  });

  it('builds the poster URL from the Drive file id when no absolute URL exists', () => {
    const { container } = renderCard({ ...mockMovie, posterDriveFileId: 'drive_poster_1' });

    // The poster is decorative (alt="") because the title sits right next to
    // it, so it is queried as an element rather than by role.
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/media/assets/drive_poster_1',
    );
  });
});

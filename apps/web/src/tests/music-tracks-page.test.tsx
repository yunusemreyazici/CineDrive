import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicTracksPage } from '../pages/MusicTracksPage';
import { t } from '../i18n';
import { renderWithProviders } from './helpers/renderWithProviders';

const mocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  request: vi.fn(),
}));

vi.mock('../components/music/MusicTrackList', () => ({
  MusicTrackList: ({ tracks }: { tracks: Array<{ id: string; title: string }> }) => (
    <div>
      {tracks.map((track) => (
        <span key={track.id}>{track.title}</span>
      ))}
    </div>
  ),
}));

vi.mock('../components/music/PlaylistDestinationModal', () => ({
  PlaylistDestinationModal: () => null,
}));

vi.mock('../hooks/useMusicApi', () => ({
  useMusicTracksInfiniteQuery: (params: unknown) => {
    mocks.request(params);
    return {
      data: {
        pages: [
          {
            tracks: [{ id: 'track-1', title: 'First track' }],
            pagination: { total: 101, page: 1, limit: 100, totalPages: 2 },
          },
        ],
      },
      fetchNextPage: mocks.fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
    };
  },
}));

describe('MusicTracksPage', () => {
  beforeEach(() => {
    mocks.fetchNextPage.mockReset();
    mocks.request.mockReset();
  });

  it('loads the catalog in pages without changing the total count', () => {
    renderWithProviders(<MusicTracksPage />, { route: '/music/tracks?search=first' });

    expect(screen.getByText('First track')).toBeInTheDocument();
    expect(screen.getByText(t.music.trackCount(101))).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith({ search: 'first', limit: 100, sortBy: 'title' });

    fireEvent.click(screen.getByRole('button', { name: t.music.loadMore }));
    expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
  });
});

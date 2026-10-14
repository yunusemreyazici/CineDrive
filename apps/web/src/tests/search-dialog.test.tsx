import type { MusicSearchDto, MusicTrackDto } from '@cinedrive/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { SearchDialog } from '../components/search/SearchDialog';
import { t } from '../i18n';
import { createTestQueryClient } from './helpers/renderWithProviders';

const track: MusicTrackDto = {
  id: 'song-without-album',
  title: 'Original Song',
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: false,
  artworkUrl: null,
  streamUrl: '/api/music/tracks/song-without-album/stream',
  createdAt: '2026-10-14T00:00:00Z',
};
const Location = () => <output aria-label="location">{useLocation().pathname}</output>;
const mount = () => {
  const queryClient = createTestQueryClient();
  const close = vi.fn();
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SearchDialog onClose={close} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, close, queryClient };
};

afterEach(() => vi.restoreAllMocks());

describe('global music search', () => {
  it('opens the song itself even without an album', async () => {
    const fetch = vi.spyOn(apiClient, 'get').mockImplementation(
      async (url) =>
        ({
          data:
            url === '/music/search' ? { tracks: [track], albums: [], artists: [] } : { media: [] },
        }) as never,
    );
    const { close, unmount, queryClient } = mount();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'original' } });
    const option = await screen.findByRole('option', { name: /Original Song/ });
    fireEvent.click(option);
    expect(screen.getByLabelText('location')).toHaveTextContent('/music/tracks/song-without-album');
    expect(close).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/music/search', {
      params: { q: 'original' },
      signal: expect.any(AbortSignal),
    });
    unmount();
    queryClient.clear();
  });

  it('includes original lyrics hits and does not duplicate title/lyrics matches', async () => {
    const lyricTrack = { ...track, id: 'lyrics-only', title: 'Different Title' };
    const response: MusicSearchDto = {
      tracks: [track],
      albums: [],
      artists: [],
      lyricsMatches: [
        { track, excerpt: 'Duplicate title match' },
        { track: lyricTrack, excerpt: 'Gözlerin geceyi aydınlatır' },
      ],
    };
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url) =>
        ({
          data: url === '/music/search' ? response : { media: [] },
        }) as never,
    );
    const { unmount, queryClient } = mount();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gozlerin' } });
    const option = await screen.findByRole('option', { name: /Gözlerin geceyi aydınlatır/ });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.click(option);
    expect(screen.getByLabelText('location')).toHaveTextContent('/music/tracks/lyrics-only');
    unmount();
    queryClient.clear();
  });

  it('keeps searching status while the music request is pending and cancels on close', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (value: { data: MusicSearchDto }) => void;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url !== '/music/search') return { data: { media: [] } } as never;
      signal = config?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const { unmount, queryClient } = mount();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'waiting' } });
    await waitFor(() => expect(signal).toBeDefined());
    expect(screen.getByText(t.search.searching)).toBeInTheDocument();
    expect(screen.queryByText(t.search.noResults('waiting'))).not.toBeInTheDocument();
    unmount();
    expect(signal?.aborted).toBe(true);
    finish({ data: { tracks: [], artists: [], albums: [] } });
    queryClient.clear();
  });
});

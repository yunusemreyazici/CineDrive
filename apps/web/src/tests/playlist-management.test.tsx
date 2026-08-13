import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicTrackDto } from '@cinedrive/shared';
import { apiClient } from '../api/client';
import { PlaylistDestinationModal } from '../components/music/PlaylistDestinationModal';
import { createTestQueryClient } from './helpers/renderWithProviders';

const track: MusicTrackDto = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Gece Sürüşü',
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: false,
  streamUrl: '/api/music/tracks/track-1/stream',
  createdAt: '2026-08-14T00:00:00.000Z',
};

const renderPicker = (onClose = vi.fn()) => {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <PlaylistDestinationModal tracks={[track]} isOpen onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
};

describe('PlaylistDestinationModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('adds all selected tracks to an existing playlist in one batch request', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        playlists: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Favoriler',
            itemCount: 2,
            duration: 240,
            updatedAt: '2026-08-14T00:00:00.000Z',
          },
        ],
      },
    } as never);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { added: 1 } } as never);
    const onClose = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /Favoriler/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/music/playlists/22222222-2222-4222-8222-222222222222/items/batch',
        { trackIds: [track.id] },
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('creates a playlist with the selected tracks from the same dialog', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { playlists: [] } } as never);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        playlist: {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Yeni Liste',
          itemCount: 1,
          duration: 120,
          updatedAt: '2026-08-14T00:00:00.000Z',
        },
      },
    } as never);
    renderPicker();

    fireEvent.change(screen.getByPlaceholderText(/Yeni çalma listesi adı/i), {
      target: { value: 'Yeni Liste' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Oluştur ve Ekle/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/music/playlists/from-tracks', {
        name: 'Yeni Liste',
        trackIds: [track.id],
      }),
    );
  });
});

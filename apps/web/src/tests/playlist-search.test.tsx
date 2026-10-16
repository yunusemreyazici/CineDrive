import type { MusicPlaylistDto, MusicTrackDto } from '@cinedrive/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicPlaylistPage } from '../pages/MusicPlaylistPage';
import { apiClient } from '../api/client';
import { renderWithProviders } from './helpers/renderWithProviders';
import { t } from '../i18n';

const player = vi.hoisted(() => ({ playTracks: vi.fn(), playShuffledTracks: vi.fn() }));
vi.mock('../features/music/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('../components/music/PlaylistDestinationModal', () => ({
  PlaylistDestinationModal: () => null,
}));
vi.mock('../components/music/PlaylistTrackPickerModal', () => ({
  PlaylistTrackPickerModal: () => null,
}));

const track = (id: string, title: string): MusicTrackDto => ({
  id,
  title,
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  isFavorite: false,
  primaryArtist: { id: 'artist', name: 'Şebnem Ferah' },
  artists: [{ id: 'guest', name: 'Konuk Şarkıcı' }],
  album: { id: 'album', title: 'Kadın', genres: [] },
  streamUrl: '/fixture.mp3',
  createdAt: '',
});
const tracks = [track('one', 'Sil Baştan'), track('two', 'Yağmurlar'), track('two', 'Yağmurlar')];
const playlist: MusicPlaylistDto = {
  id: 'list',
  name: 'Road Trip',
  itemCount: 3,
  duration: 600,
  updatedAt: '',
  items: tracks.map((track, position) => ({ id: `entry-${position}`, track, position })),
};
const renderPage = () =>
  renderWithProviders(
    <>
      <Link to="/music/playlists/other">Other playlist</Link>
      <Routes>
        <Route path="/music/playlists/:playlistId" element={<MusicPlaylistPage />} />
      </Routes>
    </>,
    { route: '/music/playlists/list' },
  );
const search = (value: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } });

describe('playlist local search', () => {
  beforeEach(() => {
    player.playTracks.mockReset();
    player.playShuffledTracks.mockReset();
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { playlist } } as never);
    vi.spyOn(apiClient, 'put').mockResolvedValue({ data: {} } as never);
    vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} } as never);
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { playlist: { ...playlist, id: 'copy' } },
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('filters title, artist and album without requests or writes and preserves duplicates', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Road Trip' });
    const calls = vi.mocked(apiClient.get).mock.calls.length;
    search('yagmur sebnem kadin');
    expect(screen.getByText(t.music.playlistMatches(2, 3))).toBeVisible();
    expect(container.querySelectorAll('.cd-track-row')).toHaveLength(2);
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0);
    expect(apiClient.get).toHaveBeenCalledTimes(calls);
    expect(apiClient.put).not.toHaveBeenCalled();
    expect(player.playTracks).not.toHaveBeenCalled();
    search('konuk sarkici');
    expect(container.querySelectorAll('.cd-track-row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: t.music.playlistClearSearch }));
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(3);
  });
  it('plays results explicitly while play-all, shuffle and duplicate keep the whole playlist', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road Trip' });
    search('yagmur');
    fireEvent.click(screen.getByRole('button', { name: t.music.playlistPlayMatches(2) }));
    expect(player.playTracks).toHaveBeenLastCalledWith(tracks.slice(1));
    fireEvent.click(screen.getByRole('button', { name: t.music.playAll }));
    expect(player.playTracks).toHaveBeenLastCalledWith(tracks);
    fireEvent.click(screen.getByRole('button', { name: t.music.shufflePlay }));
    expect(player.playShuffledTracks).toHaveBeenLastCalledWith(tracks);
    fireEvent.click(screen.getByRole('button', { name: t.music.duplicatePlaylist }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/music/playlists/from-tracks',
        expect.objectContaining({ trackIds: ['one', 'two', 'two'] }),
      ),
    );
  });
  it('removes the correct playlist occurrence after filtering, never the original row index', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Road Trip' });
    search('yagmur');
    const rows = container.querySelectorAll<HTMLElement>('.cd-track-row');
    fireEvent.click(within(rows[1]!).getByRole('button', { name: t.common.delete }));
    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith('/music/playlists/list/items/entry-2'),
    );
  });
  it('does not reorder a filtered list even on a synthetic drop', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: 'Road Trip' });
    search('yagmur');
    fireEvent.drop(container.querySelectorAll('.cd-track-row')[1]!, {
      dataTransfer: { getData: () => 'entry-1' },
    });
    expect(apiClient.put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: t.music.playlistClearSearch }));
    fireEvent.drop(container.querySelectorAll('.cd-track-row')[2]!, {
      dataTransfer: { getData: () => 'entry-0' },
    });
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/music/playlists/list/reorder', {
        itemIds: ['entry-1', 'entry-2', 'entry-0'],
      }),
    );
  });
  it('shows a reversible no-results state, distinct from an empty playlist', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road Trip' });
    search('no match');
    expect(screen.getByRole('heading', { name: t.music.playlistNoMatches })).toBeVisible();
    expect(screen.queryByText(t.music.playlistEmptyHint)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.music.playlistPlayMatches(0) })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: t.music.playlistClearSearch })[0]!);
    expect(screen.getByText(t.music.playlistMatches(3, 3))).toBeVisible();
  });
  it('resets search when navigating to another playlist', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Road Trip' });
    search('no match');
    fireEvent.click(screen.getByText('Other playlist'));
    expect(await screen.findByRole('searchbox')).toHaveValue('');
  });
  it('offers retry after a failed load and recovers', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Network unavailable'));
    renderPage();
    await screen.findByRole('alert');
    expect(screen.queryByRole('status', { name: t.common.loading })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.common.retry }));
    expect(await screen.findByRole('heading', { name: 'Road Trip' })).toBeVisible();
  });
});

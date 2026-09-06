import type { MusicTrackDto } from '@cinedrive/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { MusicTrackPage } from '../pages/MusicTrackPage';

const mocks = vi.hoisted(() => ({ playTracks: vi.fn(), query: vi.fn() }));

vi.mock('../features/music/MusicPlayerProvider', () => ({
  useMusicPlayer: () => ({ playTracks: mocks.playTracks }),
}));

vi.mock('../features/music/useArtworkPalette', () => ({
  useArtworkPalette: () => ({ primary: '40 40 40', secondary: '20 20 20' }),
}));

vi.mock('../hooks/useMusicApi', () => ({
  useMusicTrackQuery: () => mocks.query(),
}));

vi.mock('../features/music/MusicTrackInfoPanel', () => ({
  MusicTrackInfoPanel: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog">
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}));

const track: MusicTrackDto = {
  id: 'shared-track',
  title: 'Shared Song',
  discNumber: 1,
  trackNumber: 2,
  genres: [],
  album: { id: 'album-1', title: 'Shared Album', genres: [] },
  primaryArtist: { id: 'artist-1', name: 'Shared Artist' },
  artists: [{ id: 'artist-1', name: 'Shared Artist' }],
  artworkUrl: '/artwork.jpg',
  isFavorite: false,
  streamUrl: '/api/music/tracks/shared-track/stream',
  createdAt: '2026-09-06T00:00:00.000Z',
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/music/tracks/shared-track']}>
      <Routes>
        <Route path="/music/tracks/:trackId" element={<MusicTrackPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('MusicTrackPage', () => {
  beforeEach(() => {
    mocks.playTracks.mockReset();
    mocks.query.mockReturnValue({ data: track, isError: false });
  });

  it('shows the shared track and starts it only after the play action', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: track.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shared Artist' })).toHaveAttribute(
      'href',
      '/music/artists/artist-1',
    );
    expect(mocks.playTracks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: t.music.playTrack(track.title) }));
    expect(mocks.playTracks).toHaveBeenCalledWith([track]);
  });

  it('keeps technical information behind a separate action', () => {
    renderPage();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.music.trackInfo }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

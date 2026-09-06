import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { MusicMixesPage } from '../pages/MusicMixesPage';

const mocks = vi.hoisted(() => ({
  generationIds: vi.fn(),
  playTracks: vi.fn(),
  playShuffledTracks: vi.fn(),
}));

vi.mock('../components/music/MusicMixCard', () => ({
  MusicMixCard: () => <div />,
}));

vi.mock('../features/music/MusicPlayerProvider', () => ({
  useMusicPlayer: () => ({
    playTracks: mocks.playTracks,
    playShuffledTracks: mocks.playShuffledTracks,
    toggleContinuousPlay: vi.fn(),
    continuousPlayEnabled: false,
  }),
}));

vi.mock('../hooks/useMusicApi', () => ({
  useMusicDiscoveryQuery: (generationId?: string) => {
    mocks.generationIds(generationId);
    return {
      data: {
        generationId: generationId || 'daily-2026-09-06',
        generatedAt: '2026-09-06T00:00:00.000Z',
        mixes: [],
        moodCollections: [],
        genreCollections: [],
        decadeCollections: [],
        unfinishedAlbums: [],
        radioArtists: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useSaveMusicMixMutation: () => ({ mutate: vi.fn() }),
  useArtistRadioMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('MusicMixesPage', () => {
  beforeEach(() => {
    mocks.generationIds.mockReset();
  });

  it('requests a new explicit generation when the user refreshes discovery', () => {
    render(<MusicMixesPage />);
    expect(mocks.generationIds).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText(t.music.noMixesYet)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.music.refreshDiscovery }));

    const nextGeneration = mocks.generationIds.mock.calls.at(-1)?.[0];
    expect(nextGeneration).toMatch(/^web-[a-z0-9]+-1$/);
  });
});

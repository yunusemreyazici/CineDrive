import type { MusicMaintenanceDto, MusicTrackDto } from '@cinedrive/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicMaintenancePage } from '../pages/MusicMaintenancePage';
import { t } from '../i18n';

const mocks = vi.hoisted(() => ({ data: undefined as MusicMaintenanceDto | undefined }));
vi.mock('../hooks/useMusicApi', () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() });
  return {
    useMusicMaintenanceQuery: () => ({ data: mocks.data, isLoading: false, isError: false }),
    useArchiveDuplicateMutation: mutation,
    useBulkMusicMetadataMutation: mutation,
    useEditMusicArtistMaintenanceMutation: mutation,
    useFingerprintScanMutation: mutation,
    useGenerateMusicMaintenanceMutation: mutation,
    useReplayGainScanMutation: mutation,
    useResolveMusicSuggestionMutation: mutation,
    useScanArtistArtworkMutation: mutation,
    useUndoMusicMaintenanceMutation: mutation,
  };
});
afterEach(cleanup);
const report = (): MusicMaintenanceDto => ({
  artists: [],
  missingArtwork: [],
  missingMetadata: [],
  duplicates: [],
  acousticDuplicates: [],
  replayGainMissing: [],
  fingerprintCandidates: [],
  fingerprints: {
    available: false,
    acoustidConfigured: false,
    total: 0,
    analyzed: 0,
    identified: 0,
    failed: 0,
  },
  totals: {
    missingArtistArtwork: 0,
    missingArtwork: 0,
    missingMetadata: 0,
    duplicates: 0,
    acousticDuplicates: 0,
    replayGainMissing: 0,
  },
});
describe('maintenance coverage and genre review', () => {
  it('retains compatibility with older servers without coverage fields', () => {
    mocks.data = report();
    render(<MusicMaintenancePage />);
    expect(screen.getByText(t.music.libraryCare)).toBeInTheDocument();
    expect(screen.queryByText(t.music.maintenanceCoverageFull(0))).not.toBeInTheDocument();
  });
  it('shows catalogue counts separately from limited previews', () => {
    mocks.data = {
      ...report(),
      coverage: {
        catalogueTracks: 13658,
        previewTracks: 2000,
        previewLimit: 2000,
        listLimit: 100,
        totalsScope: 'catalogue',
        previewsTruncated: true,
      },
    };
    render(<MusicMaintenancePage />);
    expect(
      screen.getByText(t.music.maintenanceCoverageLimited(13658, 2000, 100)),
    ).toBeInTheDocument();
  });
  it('adds complete-but-broad tags to explicit metadata review without invented confidence', () => {
    const track: MusicTrackDto = {
      id: 'review',
      title: 'Broad Genre Track',
      discNumber: 1,
      trackNumber: 1,
      genres: ['Pop'],
      artists: [],
      isFavorite: false,
      streamUrl: '/stream',
      createdAt: '',
    };
    mocks.data = {
      ...report(),
      genreReview: { flaggedTracks: 1, items: [{ ...track, reviewReasons: ['broad-unlocked'] }] },
    };
    render(<MusicMaintenancePage />);
    fireEvent.click(screen.getByRole('button', { name: `${t.music.genreReviewTitle} · 1` }));
    expect(screen.getByText(track.title)).toBeInTheDocument();
    expect(screen.getByText(t.music.genreReviewHint(1))).toBeInTheDocument();
    expect(screen.getByText(t.music.genreReviewReasons['broad-unlocked'])).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
});

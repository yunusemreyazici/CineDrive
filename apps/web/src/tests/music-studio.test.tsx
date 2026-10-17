import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MusicStudioPage } from '../pages/MusicStudioPage';
import { StudioPlaylistEditor } from '../components/music/studio/StudioPlaylistEditor';
import { StudioProfile } from '../components/music/studio/StudioProfile';
import { apiClient, ApiRequestError } from '../api/client';
import {
  createTestQueryClient,
  renderWithProviders,
  seedSession,
} from './helpers/renderWithProviders';
import { useStudioChanges } from '../hooks/useMusicStudio';
import { t } from '../i18n';
import type { StudioWorkshopDto, MusicTrackDto } from '@cinedrive/shared';

const player = vi.hoisted(() => ({
  playTracks: vi.fn(),
  queue: [],
  position: 0,
  currentQueueItemId: null,
}));
vi.mock('../features/music/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
const track: MusicTrackDto = {
  id: 'track',
  title: 'Fixture song',
  discNumber: 1,
  trackNumber: 1,
  artists: [],
  genres: [],
  isFavorite: false,
  streamUrl: '/fixture',
  createdAt: '',
};
const workshop: StudioWorkshopDto = {
  version: 'a'.repeat(64),
  role: 'owner',
  canEdit: true,
  unavailableCount: 0,
  members: [],
  playlist: {
    id: 'list',
    name: 'Fixture list',
    itemCount: 2,
    duration: 0,
    updatedAt: '',
    items: [0, 1].map((position) => ({
      id: `00000000-0000-4000-8000-00000000000${position}`,
      position,
      track,
    })),
  },
};
describe('Music Studio', () => {
  beforeEach(() => {
    player.playTracks.mockReset();
    vi.spyOn(apiClient, 'get').mockImplementation(async (path) => {
      if (path.endsWith('/changes'))
        return { data: { cursor: 0, changes: [], hasMore: false, resetRequired: false } } as never;
      if (path.endsWith('/history')) return { data: { entries: [], nextCursor: null } } as never;
      if (path.endsWith('/profile'))
        return { data: { revision: 0, families: [], sessions: [] } } as never;
      if (path.endsWith('/playlists'))
        return { data: { playlists: [], nextCursor: null } } as never;
      if (path.endsWith('/tracks'))
        return { data: { tracks: [], pagination: { page: 1, totalPages: 1 } } } as never;
      return { data: workshop } as never;
    });
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { playlist: { id: 'created' } },
    } as never);
    vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 'b'.repeat(64) } } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it.each(['workshop', 'profile'])(
    'uses bounded real search parameters in %s and hides unrelated results',
    async (surface) => {
      const original = vi.mocked(apiClient.get).getMockImplementation()!;
      vi.mocked(apiClient.get).mockImplementation(async (path, config) => {
        if (path === '/music/tracks')
          return {
            data: {
              tracks:
                config?.params?.search === 'Smoke'
                  ? [{ ...track, title: 'Search-only result' }]
                  : [],
              pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
            },
          } as never;
        return original(path, config);
      });
      renderWithProviders(
        surface === 'workshop' ? (
          <StudioPlaylistEditor owner="user-1" id="list" lists={[]} />
        ) : (
          <StudioProfile owner="user-1" />
        ),
      );
      const input = await screen.findByLabelText(t.studio.search);
      expect(
        vi.mocked(apiClient.get).mock.calls.filter(([path]) => path === '/music/tracks'),
      ).toHaveLength(0);
      fireEvent.change(input, { target: { value: 'S' } });
      fireEvent.change(input, { target: { value: 'Sm' } });
      fireEvent.change(input, { target: { value: ' Smoke ' } });
      await screen.findByText('Search-only result', { exact: false });
      const calls = vi
        .mocked(apiClient.get)
        .mock.calls.filter(([path]) => path === '/music/tracks');
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]).toMatchObject({
        params: { search: 'Smoke', limit: 20, page: 1 },
        signal: expect.any(AbortSignal),
      });
      fireEvent.change(input, { target: { value: 'No matches' } });
      expect(screen.queryByText('Search-only result', { exact: false })).not.toBeInTheDocument();
      await screen.findByText(t.studio.noSearchMatches);
    },
  );
  it('cancels lookup requests when the term changes or the editor unmounts', async () => {
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    const signals: AbortSignal[] = [];
    vi.mocked(apiClient.get).mockImplementation(async (path, config) => {
      if (path === '/music/tracks') {
        signals.push(config!.signal!);
        return new Promise(() => {}) as never;
      }
      return original(path, config);
    });
    const view = renderWithProviders(<StudioPlaylistEditor owner="user-1" id="list" lists={[]} />);
    const input = await screen.findByLabelText(t.studio.search);
    fireEvent.change(input, { target: { value: 'Smoke' } });
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'Other' } });
    expect(signals[0]!.aborted).toBe(true);
    await waitFor(() => expect(signals).toHaveLength(2));
    view.unmount();
    expect(signals[1]!.aborted).toBe(true);
  });

  it('creates only on explicit submit and keeps an operation ID for a network retry', async () => {
    const queryClient = createTestQueryClient();
    seedSession(queryClient);
    vi.mocked(apiClient.post).mockRejectedValueOnce(new ApiRequestError(0, null, 'Network lost'));
    renderWithProviders(<MusicStudioPage />, { queryClient });
    await screen.findByText(t.studio.empty);
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: t.studio.name }), {
      target: { value: 'New list' },
    });
    fireEvent.click(screen.getByRole('button', { name: t.studio.create }));
    const retry = await screen.findByRole('button', { name: t.studio.retryWrite });
    expect(screen.getByRole('button', { name: t.studio.create })).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiClient.post).mock.calls[0]![1]).toEqual(
      vi.mocked(apiClient.post).mock.calls[1]![1],
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: t.studio.name })).toHaveValue(''),
    );
  });
  it('removes duplicate occurrences without dropping the first occurrence and sends version', async () => {
    renderWithProviders(<StudioPlaylistEditor owner="user-1" id="list" lists={[]} />);
    await screen.findByRole('heading', { name: 'Fixture list' });
    fireEvent.click(screen.getByRole('button', { name: t.studio.duplicates }));
    expect(screen.getByText(t.studio.selected(1))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: t.studio.remove }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.put).mock.calls[0]![1]).toMatchObject({
      version: workshop.version,
      operationId: expect.any(String),
      items: [{ id: workshop.playlist.items![0]!.id, trackId: 'track' }],
    });
  });
  it('disables listener writes and hides stale tracks when refetch loses permission', async () => {
    let denied = false;
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (path, config) => {
      if (path.endsWith('/playlists/list')) {
        if (denied) throw new ApiRequestError(404, null, 'Unavailable');
        return { data: { ...workshop, role: 'listener', canEdit: false } } as never;
      }
      return original(path, config);
    });
    renderWithProviders(<StudioPlaylistEditor owner="user-1" id="list" lists={[]} />);
    await screen.findByRole('heading', { name: 'Fixture list' });
    fireEvent.click(screen.getByRole('button', { name: t.studio.selectAll }));
    expect(screen.getByRole('button', { name: t.studio.remove })).toBeDisabled();
    denied = true;
    fireEvent.click(screen.getByRole('button', { name: t.studio.refresh }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Fixture song')).not.toBeInTheDocument();
    expect(apiClient.put).not.toHaveBeenCalled();
  });
  it('preserves session occurrences and restores exact index/position', async () => {
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (path, config) => {
      if (path.endsWith('/profile'))
        return {
          data: {
            revision: 1,
            families: [],
            sessions: [
              {
                id: 'session',
                name: 'Night',
                trackIds: ['track', 'track'],
                index: 1,
                position: 42,
                savedAt: '2026-10-17T00:00:00Z',
              },
            ],
          },
        } as never;
      if (path.includes('/sessions/'))
        return { data: { tracks: [track, track], index: 1, position: 42 } } as never;
      return original(path, config);
    });
    renderWithProviders(<StudioProfile owner="user-1" />);
    fireEvent.click(await screen.findByRole('button', { name: t.studio.resume }));
    await waitFor(() => expect(player.playTracks).toHaveBeenCalledWith([track, track], 1, 42));
  });
  it('catches up using the previous cursor and invalidates only affected playlists', async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const Harness = () => {
      useStudioChanges('user-1');
      return null;
    };
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        data: { cursor: 7, changes: [], hasMore: false, resetRequired: false },
      } as never)
      .mockResolvedValueOnce({
        data: {
          cursor: 9,
          changes: [
            { id: 8, playlistId: 'list', kind: 'edit' },
            { id: 9, playlistId: 'list', kind: 'edit' },
          ],
          hasMore: false,
          resetRequired: false,
        },
      } as never);
    renderWithProviders(<Harness />, { queryClient });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    invalidate.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiClient.get).mock.calls[1]![1]?.params).toEqual({ cursor: 7 });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['music-studio', 'user-1', 'playlist', 'list'],
    });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['music'] });
    expect(
      invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === 'playlist'),
    ).toHaveLength(1);
  });
  it('evicts mounted playlist and history data immediately after a membership event', async () => {
    let revoked = false;
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (path, config) => {
      if (path.endsWith('/changes'))
        return {
          data: {
            cursor: revoked ? 8 : 7,
            changes: revoked ? [{ id: 8, playlistId: 'list', kind: 'membership' }] : [],
            resetRequired: false,
            hasMore: false,
          },
        } as never;
      if (revoked && path.includes('/playlists/list'))
        throw new ApiRequestError(404, null, 'Unavailable');
      return original(path, config);
    });
    const Harness = () => {
      useStudioChanges('user-1');
      return <StudioPlaylistEditor owner="user-1" id="list" lists={[]} />;
    };
    renderWithProviders(<Harness />);
    await screen.findByRole('heading', { name: 'Fixture list' });
    revoked = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByRole('alert');
    expect(screen.queryByText('Fixture song')).not.toBeInTheDocument();
  });
  it('does not start a restored session after its view unmounts', async () => {
    let resolve!: (value: unknown) => void;
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (path, config) => {
      if (path.endsWith('/profile'))
        return {
          data: {
            revision: 1,
            families: [],
            sessions: [
              {
                id: 'session',
                name: 'Night',
                trackIds: ['track'],
                index: 0,
                position: 42,
                savedAt: '2026-10-17T00:00:00Z',
              },
            ],
          },
        } as never;
      if (path.includes('/sessions/'))
        return new Promise((r) => {
          resolve = r;
        }) as never;
      return original(path, config);
    });
    const view = renderWithProviders(<StudioProfile owner="user-1" />);
    fireEvent.click(await screen.findByRole('button', { name: t.studio.resume }));
    view.unmount();
    await act(async () => resolve({ data: { tracks: [track], index: 0, position: 42 } }));
    expect(player.playTracks).not.toHaveBeenCalled();
  });
});

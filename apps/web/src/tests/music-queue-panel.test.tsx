import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicTrackDto } from '@cinedrive/shared';
import { MusicPlayerProvider, useMusicPlayer } from '../features/music/MusicPlayerProvider';
import { MusicQueuePanel } from '../features/music/MusicQueuePanel';
import {
  createTestQueryClient,
  renderWithProviders,
  seedSession,
} from './helpers/renderWithProviders';
import { t } from '../i18n';

vi.mock('../hooks/useMusicApi', () => ({
  fetchMusicPlaybackState: async () => ({
    revision: 0,
    queue: [],
    currentQueueItemId: null,
    positionSeconds: 0,
    shuffleEnabled: false,
    repeatMode: 'off',
  }),
  saveMusicPlaybackState: async () => ({ revision: 1 }),
  fetchTrackRadio: async () => ({ tracks: [] }),
}));
const track = (id: string, title: string): MusicTrackDto => ({
  id,
  title,
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: false,
  duration: 200,
  streamUrl: `/music/${id}`,
  createdAt: '',
  primaryArtist: { id: 'artist', name: 'Şebnem Ferah' },
  album: { id: 'album', title: 'Kadın', genres: [] },
});
const tracks = [track('one', 'Sil Baştan'), track('two', 'Yağmurlar'), track('three', 'Vazgeçtim')];
let player: ReturnType<typeof useMusicPlayer>;
const close = vi.fn();
const save = vi.fn();
function Harness() {
  const value = useMusicPlayer();
  useLayoutEffect(() => {
    player = value;
  }, [value]);
  return <MusicQueuePanel onClose={close} onSave={save} />;
}
async function setup() {
  const queryClient = createTestQueryClient();
  seedSession(queryClient);
  const view = renderWithProviders(
    <MusicPlayerProvider>
      <Harness />
    </MusicPlayerProvider>,
    { queryClient },
  );
  await act(async () => {
    await Promise.resolve();
  });
  act(() => player.playTracks(tracks));
  return view;
}
describe('queue panel with real player state', () => {
  beforeEach(() => {
    close.mockClear();
    save.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  });
  afterEach(() => vi.restoreAllMocks());

  it('searches Turkish title, artist and album without editing or starting the queue', async () => {
    await setup();
    const original = player.queue;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sebnem kadin yagmur' } });
    expect(screen.getByText('Yağmurlar')).toBeVisible();
    expect(screen.queryByText('Sil Baştan')).not.toBeInTheDocument();
    expect(player.queue).toBe(original);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing here' } });
    expect(screen.getByText(t.music.queueNoMatches)).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByText(t.music.queueMatches(3, 3))).toBeVisible();
  });
  it('marks current and next in playback order, including repeat-one and repeat-all', async () => {
    await setup();
    expect(screen.getByText('Sil Baştan').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByText(t.music.queueUpNext).closest('button')).toHaveTextContent('Yağmurlar');
    act(() => player.cycleRepeat());
    act(() => player.playQueueItem(player.queue[2]!.id));
    expect(screen.getByText(t.music.queueUpNext).closest('button')).toHaveTextContent('Sil Baştan');
    act(() => player.cycleRepeat());
    expect(screen.queryByText(t.music.queueUpNext)).not.toBeInTheDocument();
  });
  it('restores the exact duplicate entry and order without changing playback or seeking', async () => {
    const { container } = await setup();
    act(() => player.addToQueue(tracks[1]!));
    const before = player.queue;
    const current = player.currentQueueItemId;
    const audio = container.querySelector('audio')!;
    audio.currentTime = 37;
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    vi.mocked(HTMLMediaElement.prototype.load).mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: t.music.queueRemove('Yağmurlar') })[1]!);
    expect(player.queue.map((entry) => entry.id)).toEqual(
      before.slice(0, 3).map((entry) => entry.id),
    );
    fireEvent.click(screen.getByRole('button', { name: t.music.queueUndo }));
    expect(player.queue).toEqual(before);
    expect(player.currentQueueItemId).toBe(current);
    expect(audio.currentTime).toBe(37);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: t.music.queueUndo })).not.toBeInTheDocument();
  });
  it.each(['append', 'replace', 'shuffle'] as const)(
    'invalidates undo after %s instead of overwriting the new queue',
    async (operation) => {
      await setup();
      act(() => player.removeFromQueue(player.queue[1]!.id));
      const staleUndo = player.undoQueueRemoval;
      act(() => {
        if (operation === 'append') player.addToQueue(tracks[1]!);
        if (operation === 'replace') player.playTracks([tracks[2]!]);
        if (operation === 'shuffle') player.toggleShuffle();
        staleUndo();
      });
      expect(player.queue.length).toBe(
        operation === 'append' ? 3 : operation === 'replace' ? 1 : 2,
      );
      expect(player.removedQueueTitle).toBeNull();
    },
  );
  it('does not offer the previous account removal after an account change', async () => {
    const { queryClient } = await setup();
    act(() => player.removeFromQueue(player.queue[1]!.id));
    expect(player.removedQueueTitle).toBe('Yağmurlar');
    act(() => {
      queryClient.setQueryData(['session'], { authenticated: true, user: { id: 'other' } });
    });
    await waitFor(() => expect(player.removedQueueTitle).toBeNull());
    act(() => player.undoQueueRemoval());
    expect(player.queue).toHaveLength(2);
  });
  it('cancels pending autoplay when removing and undoing the last track, even with repeat-all', async () => {
    const { container } = await setup();
    act(() => player.playTracks([tracks[0]!]));
    act(() => player.cycleRepeat());
    act(() => player.removeFromQueue(player.currentQueueItemId!));
    expect(player.queue).toHaveLength(0);
    expect(screen.getByRole('button', { name: t.music.queueUndo })).toBeVisible();
    act(() => player.undoQueueRemoval());
    const audio = container.querySelector('audio')!;
    fireEvent.loadedMetadata(audio);
    expect(player.queue).toHaveLength(1);
    expect(player.isPlaying).toBe(false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it('undo after removing the selected track does not return playback to it', async () => {
    await setup();
    const before = player.queue;
    act(() => player.removeFromQueue(player.currentQueueItemId!));
    expect(player.currentQueueItemId).toBe(before[1]!.id);
    act(() => player.undoQueueRemoval());
    expect(player.queue).toEqual(before);
    expect(player.currentQueueItemId).toBe(before[1]!.id);
  });
  it('closes with Escape and saves the whole queue even while searching', async () => {
    await setup();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'yagmur' } });
    fireEvent.click(screen.getByRole('button', { name: t.music.saveQueueAsPlaylist }));
    expect(save).toHaveBeenCalledOnce();
    expect(player.queue).toHaveLength(3);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

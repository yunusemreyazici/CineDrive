import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicTrackDto } from '@cinedrive/shared';
import { apiClient } from '../api/client';
import { MusicPlayerProvider, useMusicPlayer } from '../features/music/MusicPlayerProvider';
import {
  renderWithProviders,
  createTestQueryClient,
  seedSession,
} from './helpers/renderWithProviders';
import type { MusicListeningEvent } from '../features/music/musicListeningHistory';
import { useToastStore } from '../stores/useToastStore';
import { t } from '../i18n';

const radio = vi.hoisted(() => ({ fetch: vi.fn() }));

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
  fetchTrackRadio: radio.fetch,
}));
const track: MusicTrackDto = {
  id: '12345678-1234-4234-8234-123456789abc',
  title: 'Fixture',
  discNumber: 1,
  trackNumber: 1,
  genres: [],
  artists: [],
  isFavorite: false,
  duration: 240,
  streamUrl: '/fixture.mp3',
  createdAt: '',
};
const Harness = () => {
  const player = useMusicPlayer();
  return (
    <>
      <button onClick={() => player.playTracks([track])}>Start</button>
      <button onClick={() => player.seek(239)}>Seek</button>
      <button onClick={() => player.setSleepTimer(15)}>Sleep</button>
      <button onClick={player.pause}>Pause explicitly</button>
      <button onClick={player.cycleRepeat}>Repeat</button>
      <output aria-label="playing">{String(player.isPlaying)}</output>
      <output aria-label="sleep">{String(player.sleepTimerEndsAt)}</output>
      <span>{player.currentTrack?.title}</span>
    </>
  );
};

describe('provider meaningful history integration', () => {
  let clock = 0;
  beforeEach(() => {
    radio.fetch.mockReset().mockResolvedValue({ tracks: [] });
    useToastStore.getState().clear();
    vi.spyOn(performance, 'now').mockImplementation(() => clock * 1000);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(apiClient, 'post').mockImplementation(async (_path, body) => ({
      data: {
        acceptedEventIds: (body as { events: MusicListeningEvent[] }).events.map(
          (event) => event.eventId,
        ),
        rejectedEventIds: [],
      },
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clock = 0;
  });
  const setup = async () => {
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
    fireEvent.click(screen.getByText('Start'));
    await screen.findByText('Fixture');
    const audio = [...view.container.querySelectorAll('audio')].find((element) =>
      element.getAttribute('src'),
    )!;
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    Object.defineProperty(audio, 'readyState', { configurable: true, value: 4 });
    audio.currentTime = 0;
    fireEvent.playing(audio);
    return { audio, ...view };
  };
  it('does not submit a history event after seeking to the end', async () => {
    const { audio } = await setup();
    clock = 1;
    fireEvent.click(screen.getByText('Seek'));
    fireEvent.timeUpdate(audio);
    audio.currentTime = 240;
    clock = 2;
    fireEvent.ended(audio);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('pauses both slots on timer expiry and keeps the selected track and position', async () => {
    const { audio, container } = await setup();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fireEvent.play(audio);
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);
    fireEvent.click(screen.getByText('Sleep'));
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    now += 15 * 60_000 + 1;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('playing')).toHaveTextContent('false');
    expect(screen.getByLabelText('sleep')).toHaveTextContent('null');
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(audio.currentTime).toBe(42);
    expect(container.querySelectorAll('audio')).toHaveLength(2);
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.loadedMetadata(audio);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(
      useToastStore.getState().toasts.filter((item) => item.message === t.music.sleepTimerFinished),
    ).toHaveLength(1);
  });

  it('does not restart playback when a pending radio resolves after timer expiry', async () => {
    const { audio } = await setup();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let resolveRadio!: (value: { tracks: MusicTrackDto[] }) => void;
    radio.fetch.mockClear();
    radio.fetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRadio = resolve;
      }),
    );
    fireEvent.click(screen.getByText('Sleep'));
    fireEvent.ended(audio);
    await waitFor(() => expect(radio.fetch).toHaveBeenCalledOnce());
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    now += 15 * 60_000 + 1;
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => {
      resolveRadio({ tracks: [{ ...track, id: 'radio-next', title: 'Late radio' }] });
    });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(screen.getByLabelText('playing')).toHaveTextContent('false');
  });

  it('does not restart repeat-one from an ended event queued before expiry', async () => {
    const { audio } = await setup();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fireEvent.click(screen.getByText('Repeat'));
    fireEvent.click(screen.getByText('Repeat'));
    fireEvent.click(screen.getByText('Sleep'));
    now += 15 * 60_000 + 1;
    act(() => window.dispatchEvent(new Event('focus')));
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.ended(audio);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByLabelText('playing')).toHaveTextContent('false');
  });
  it('submits the entire actual listen once through the idempotent batch endpoint', async () => {
    const { audio } = await setup();
    for (clock = 1; clock <= 240; clock++) {
      audio.currentTime = clock;
      fireEvent.timeUpdate(audio);
    }
    clock = 240;
    fireEvent.ended(audio);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/music/history/batch', {
      events: [
        expect.objectContaining({
          trackId: track.id,
          listenedSeconds: 240,
          eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      ],
    });
  });

  it('retries a failed upload with the same event ID rather than adding a duplicate', async () => {
    const { audio } = await setup();
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('network fixture'));
    for (clock = 1; clock <= 30; clock++) {
      audio.currentTime = clock;
      fireEvent.timeUpdate(audio);
    }
    clock = 30;
    fireEvent.ended(audio);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const first = vi.mocked(apiClient.post).mock.calls[0]![1] as { events: MusicListeningEvent[] };
    clock = 40;
    fireEvent.click(screen.getByText('Start'));
    audio.currentTime = 0;
    fireEvent.playing(audio);
    for (let second = 1; second <= 30; second++) {
      clock = 40 + second;
      audio.currentTime = second;
      fireEvent.timeUpdate(audio);
    }
    fireEvent.ended(audio);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    const retry = vi.mocked(apiClient.post).mock.calls[1]![1] as { events: MusicListeningEvent[] };
    expect(retry.events).toHaveLength(2);
    expect(retry.events[0]).toEqual(first.events[0]);
    expect(retry.events[1]!.eventId).not.toBe(first.events[0]!.eventId);
  });

  it('discards the previous accounts unfinished listening session on account change', async () => {
    const { audio, queryClient } = await setup();
    for (clock = 1; clock <= 40; clock++) {
      audio.currentTime = clock;
      fireEvent.timeUpdate(audio);
    }
    await act(async () => {
      queryClient.setQueryData(['session'], { authenticated: true, user: { id: 'other-user' } });
    });
    fireEvent.ended(audio);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

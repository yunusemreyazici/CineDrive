import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  alignSubtitleCueToPlaybackTimeline,
  MediaPlayer,
} from '../features/player/components/MediaPlayer';
import { ResumeOverlay } from '../features/player/components/ResumeOverlay';
import { NextEpisodeOverlay } from '../features/player/components/NextEpisodeOverlay';
import { PlayerError } from '../features/player/components/PlayerError';
import { SubtitleMenu } from '../features/player/components/SubtitleMenu';
import type { MediaItemType } from '../types/media';

describe('Player Components Unit Tests', () => {
  const hlsSessionId = '00000000-0000-4000-8000-000000000000';

  it('aligns absolute subtitle cues with a restarted Safari HLS timeline', () => {
    expect(alignSubtitleCueToPlaybackTimeline(2030.5, 2033, 2028, 0)).toEqual({
      startTime: 2.5,
      endTime: 5,
    });
    expect(alignSubtitleCueToPlaybackTimeline(2030.5, 2033, 2028, 0.4)).toEqual({
      startTime: 2.9,
      endTime: 5.4,
    });
  });

  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(hlsSessionId);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockMovie: MediaItemType = {
    id: 'media_movie_10',
    type: 'movie',
    title: 'Interstellar',
    normalizedTitle: 'interstellar',
    movie: {
      id: 'movie_10_inst',
      driveFileId: 'gdrive_interstellar_file',
    },
  };
  const mockSeries: MediaItemType = {
    id: 'media_series_test',
    type: 'series',
    title: 'Test Series',
    normalizedTitle: 'test-series',
    series: {
      id: 'series_test',
      seasons: [
        {
          id: 'season_test',
          seasonNumber: 1,
          episodes: [
            {
              id: 'episode_1',
              seasonNumber: 1,
              episodeNumber: 1,
              title: 'Episode 1',
              driveFileId: 'file_1',
            },
            {
              id: 'episode_2',
              seasonNumber: 1,
              episodeNumber: 2,
              title: 'Episode 2',
              driveFileId: 'file_2',
            },
          ],
        },
      ],
    },
  };

  it('renders ResumeOverlay with position time and handles choice', () => {
    const onResume = vi.fn();
    const onRestart = vi.fn();

    render(
      <ResumeOverlay
        savedPositionSeconds={1250}
        onResume={onResume}
        onRestart={onRestart}
      />,
    );

    expect(screen.getByText(/kaldığın yerden devam et/i)).toBeInTheDocument();
    expect(screen.getByText(/baştan başlat/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/baştan başlat/i));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('renders NextEpisodeOverlay with countdown and play next action', () => {
    const onPlayNext = vi.fn();
    const onCancel = vi.fn();

    render(
      <NextEpisodeOverlay
        nextEpisodeTitle="The Narrow Way"
        seasonNumber={1}
        episodeNumber={2}
        onPlayNext={onPlayNext}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('The Narrow Way')).toBeInTheDocument();
    expect(screen.getByText(/hemen oynat/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/hemen oynat/i));
    expect(onPlayNext).toHaveBeenCalledTimes(1);
  });

  it('renders PlayerError with unsupported codec message', () => {
    const onRetry = vi.fn();

    render(
      <PlayerError
        error={{
          code: 'CODEC_NOT_SUPPORTED',
          message: 'Unsupported format',
          isRetryable: false,
        }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/video biçimi desteklenmiyor/i)).toBeInTheDocument();
    expect(screen.getByText(/Ses\/Safari Uyum Modunu/i)).toBeInTheDocument();
  });

  it('renders MediaPlayer container with video stream URL', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Interstellar')).toBeInTheDocument();
  });

  it('keeps Safari on direct MP4 first and falls back to full transcode after a media error', () => {
    const userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      );

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream',
    );

    fireEvent.error(video!);

    expect(video?.getAttribute('src')).toBe(
      `/api/media/gdrive_interstellar_file/hls/index.m3u8?start=0&session=${hlsSessionId}`,
    );
    expect(screen.queryByText('Oynatma Hatası')).not.toBeInTheDocument();

    userAgentSpy.mockRestore();
  });

  it('uses the analyzed playback plan before the first media request', () => {
    const plannedMovie: MediaItemType = {
      ...mockMovie,
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'audio',
          reason: 'mkv:h264:dts',
          analyzed: true,
        },
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={plannedMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream?transcode=audio&start=0',
    );
  });

  it('restarts the Chrome audio compatibility stream at the seek position', () => {
    vi.useFakeTimers();
    const plannedMovie: MediaItemType = {
      ...mockMovie,
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'audio',
          reason: 'mkv:h264:dts',
          analyzed: true,
        },
        technicalMetadata: {
          mediaDuration: 1000,
          mediaHeight: 1080,
        },
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={plannedMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    vi.spyOn(video, 'play').mockResolvedValue();
    fireEvent.loadedMetadata(video);
    fireEvent.keyDown(window, { key: '5' });

    expect(video.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream?transcode=audio&start=0',
    );
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(video.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream?transcode=audio&start=500',
    );
  });

  it('debounces Safari HLS seeks and starts only the final requested window', () => {
    vi.useFakeTimers();
    const userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      );
    const plannedMovie: MediaItemType = {
      ...mockMovie,
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'full',
          reason: 'mp4:hevc:aac',
          analyzed: true,
        },
        technicalMetadata: {
          mediaDuration: 1000,
          mediaHeight: 1080,
        },
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={plannedMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    vi.spyOn(video, 'play').mockResolvedValue();
    expect(video.getAttribute('src')).toBe(
      `/api/media/gdrive_interstellar_file/hls/index.m3u8?start=0&session=${hlsSessionId}`,
    );

    fireEvent.loadedMetadata(video);
    fireEvent.keyDown(window, { key: '5' });
    fireEvent.keyDown(window, { key: '7' });

    expect(video.getAttribute('src')).toBe(
      `/api/media/gdrive_interstellar_file/hls/index.m3u8?start=0&session=${hlsSessionId}`,
    );
    expect(screen.getByText('11:40 konumundan akış hazırlanıyor')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(video.getAttribute('src')).toBe(
      `/api/media/gdrive_interstellar_file/hls/index.m3u8?start=700&session=${hlsSessionId}`,
    );
    userAgentSpy.mockRestore();
  });

  it('does not reopen the resume prompt after a Safari HLS source change', () => {
    vi.useFakeTimers();
    const userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      );
    const resumableMovie: MediaItemType = {
      ...mockMovie,
      progress: {
        positionSeconds: 154,
        durationSeconds: 1000,
        percentage: 15.4,
        completed: false,
      },
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'full',
          reason: 'mp4:hevc:aac',
          analyzed: true,
        },
        technicalMetadata: {
          mediaDuration: 1000,
          mediaHeight: 1080,
        },
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={resumableMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'pause').mockImplementation(() => {});
    fireEvent.loadedMetadata(video);
    expect(screen.getByText('İzlemeye Devam Et')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /Kaldığın Yerden Devam Et/ }),
    );
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(video.getAttribute('src')).toBe(
      `/api/media/gdrive_interstellar_file/hls/index.m3u8?start=154&session=${hlsSessionId}`,
    );

    fireEvent.loadedMetadata(video);
    expect(screen.queryByText('İzlemeye Devam Et')).not.toBeInTheDocument();
    userAgentSpy.mockRestore();
  });

  it('releases the active Safari HLS encoder when the player unmounts', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      );
    const plannedMovie: MediaItemType = {
      ...mockMovie,
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'full',
          reason: 'mp4:hevc:aac',
          analyzed: true,
        },
      },
    };

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={plannedMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    unmount();

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/media/gdrive_interstellar_file/hls/release?start=0&session=${hlsSessionId}`,
      {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      },
    );
    userAgentSpy.mockRestore();
  });

  it('releases every superseded HLS stream during Safari back-forward stress', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const userAgentSpy = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      );
    const createPlannedMovie = (
      id: string,
      driveFileId: string,
      title: string,
    ): MediaItemType => ({
      ...mockMovie,
      id,
      title,
      movie: {
        ...mockMovie.movie!,
        driveFileId,
        playbackPlan: {
          safari: 'hls',
          chromium: 'full',
          reason: 'mkv:hevc:aac',
          analyzed: true,
        },
      },
    });
    const firstMovie = createPlannedMovie(
      'media_first',
      'first_drive_file',
      'First Movie',
    );
    const secondMovie = createPlannedMovie(
      'media_second',
      'second_drive_file',
      'Second Movie',
    );

    const { rerender, unmount } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={firstMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={secondMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={firstMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );
    window.dispatchEvent(new Event('pagehide'));
    unmount();

    const releaseUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/hls/release'));
    expect(releaseUrls).toEqual(
      expect.arrayContaining([
        `/api/media/first_drive_file/hls/release?start=0&session=${hlsSessionId}`,
        `/api/media/second_drive_file/hls/release?start=0&session=${hlsSessionId}`,
      ]),
    );
    expect(releaseUrls.filter((url) => url.includes('first_drive_file')).length)
      .toBeGreaterThanOrEqual(2);
    userAgentSpy.mockRestore();
  });

  it('resumes playback after switching to compatibility mode', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    const playSpy = vi.spyOn(video, 'play').mockResolvedValue();

    fireEvent.click(screen.getByRole('button', { name: 'Ses / Safari Uyum Modu' }));
    expect(video.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream?transcode=audio&start=0',
    );

    fireEvent.canPlay(video);
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it('adds the selected quality profile to a full transcode request', () => {
    const plannedMovie: MediaItemType = {
      ...mockMovie,
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'full',
          reason: 'mkv:hevc:eac3',
          analyzed: true,
        },
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={plannedMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream?transcode=full&quality=1080p&start=0',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Görüntü Kalitesi' }));
    fireEvent.click(screen.getByRole('button', { name: /720p/ }));

    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream?transcode=full&quality=720p&start=0',
    );
  });

  it('does not replace a required full Chrome compatibility plan with audio-only mode', () => {
    const plannedMovie: MediaItemType = {
      ...mockMovie,
      movie: {
        ...mockMovie.movie!,
        playbackPlan: {
          safari: 'hls',
          chromium: 'full',
          reason: 'mp4:hevc:eac3',
          analyzed: true,
        },
      },
    };

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={plannedMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ses / Safari Uyum Modu' }));
    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/api/media/gdrive_interstellar_file/stream',
    );
  });

  it('reconnects a stalled direct stream after the recovery threshold', () => {
    vi.useFakeTimers();
    const { container, unmount } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockMovie} />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: 42,
    });
    const loadSpy = vi.spyOn(video, 'load').mockImplementation(() => {});

    fireEvent.waiting(video);
    act(() => {
      vi.advanceTimersByTime(12_000);
    });

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Bağlantı yeniden kuruluyor (1/2)')).toBeInTheDocument();

    unmount();
    vi.useRealTimers();
  });

  it('does not reopen the next episode overlay after the user dismisses it', () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockSeries} episodeId="episode_1" />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 95,
    });
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 21_000);

    fireEvent.timeUpdate(video);
    expect(screen.getByText('Sonraki Bölüm')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText('Sonraki Bölüm')).not.toBeInTheDocument();

    fireEvent.timeUpdate(video);
    expect(screen.queryByText('Sonraki Bölüm')).not.toBeInTheDocument();
    dateNowSpy.mockRestore();
  });

  it('ignores impossible transient timestamps while a transcode source changes', () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockSeries} episodeId="episode_1" />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 10_000,
    });

    fireEvent.timeUpdate(video);
    expect(screen.queryByText('Sonraki Bölüm')).not.toBeInTheDocument();
  });

  it('suppresses the next episode overlay during a compatibility source change', () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MediaPlayer media={mockSeries} episodeId="episode_1" />
        </BrowserRouter>
      </QueryClientProvider>,
    );

    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 95,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ses / Safari Uyum Modu' }));
    fireEvent.timeUpdate(video);
    fireEvent.ended(video);
    expect(screen.queryByText('Sonraki Bölüm')).not.toBeInTheDocument();
  });

  it('passes the OpenSubtitles fileId to the download handler', async () => {
    const onSelectOpenSubtitle = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: '456',
              fileId: 456,
              filename: 'Taboo.S01E02.tr.srt',
              languageName: 'Türkçe',
              languageCode: 'tr',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(
      <SubtitleMenu
        mediaId="media_series_test"
        seasonNumber={1}
        episodeNumber={2}
        subtitles={[]}
        activeSubtitleId={null}
        onSelectSubtitle={vi.fn()}
        onSelectOpenSubtitle={onSelectOpenSubtitle}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    await screen.findByText('Taboo.S01E02.tr.srt');
    fireEvent.click(screen.getByText('Taboo.S01E02.tr.srt'));

    await waitFor(() =>
      expect(onSelectOpenSubtitle).toHaveBeenCalledWith(
        456,
        'Türkçe (OpenSubtitles)',
        'tr',
      ),
    );
    expect(onClose).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

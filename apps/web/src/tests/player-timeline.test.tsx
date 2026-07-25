import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerTimeline } from '../features/player/components/PlayerTimeline';

describe('PlayerTimeline previews', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a cached ten-second preview near the hovered time', () => {
    vi.useFakeTimers();
    const { container } = render(
      <PlayerTimeline
        currentTime={0}
        duration={100}
        previewDriveFileId="drive-file-1"
        onSeek={() => {}}
      />,
    );
    const timeline = container.firstElementChild as HTMLDivElement;
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(timeline, { clientX: 57 });
    act(() => vi.advanceTimersByTime(220));

    const image = container.querySelector('img');
    expect(image).toHaveAttribute(
      'src',
      '/api/media/drive-file-1/preview?time=50',
    );
    expect(screen.getByText('0:56')).toBeInTheDocument();
  });
});

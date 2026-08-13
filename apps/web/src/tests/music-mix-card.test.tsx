import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MusicMixCard } from '../components/music/MusicMixCard';

const mix = {
  id: 'genre-rock',
  type: 'genre' as const,
  title: 'Rock',
  subtitle: 'Rock seçkisi',
  accent: 'violet',
  artworkUrls: [],
  tracks: [
    {
      id: 'track-1',
      title: 'Track',
      discNumber: 1,
      trackNumber: 1,
      genres: ['Rock'],
      artists: [],
      isFavorite: false,
      streamUrl: '/api/music/tracks/track-1/stream',
      createdAt: '2026-08-14T00:00:00.000Z',
    },
  ],
};

describe('MusicMixCard', () => {
  it('keeps play and save as separate accessible actions', () => {
    const onPlay = vi.fn();
    const onSave = vi.fn();
    render(<MusicMixCard mix={mix} onPlay={onPlay} onSave={onSave} compact landscape />);

    fireEvent.click(screen.getByRole('button', { name: /Rock mix’ini oynat/i }));
    fireEvent.click(screen.getByRole('button', { name: /çalma listelerine kaydet/i }));

    expect(onPlay).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('disables the save action after the mix is saved', () => {
    render(<MusicMixCard mix={mix} onPlay={vi.fn()} onSave={vi.fn()} saved landscape />);
    expect(screen.getByRole('button', { name: /kaydedildi/i })).toBeDisabled();
  });
});

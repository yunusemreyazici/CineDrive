import { describe, expect, it } from 'vitest';
import type { MusicMixDto } from '@cinedrive/shared';
import { presentMusicMixForNativeClient } from '../src/utils/music-presentation.js';

const mix = (overrides: Partial<MusicMixDto> = {}): MusicMixDto => ({
  id: 'genre-rock',
  type: 'genre',
  title: 'Rock',
  subtitle: '4170 parcalik tur seckisi',
  accent: '#333333',
  artworkUrls: [],
  tracks: [],
  ...overrides,
});

describe('native music mix presentation', () => {
  it('keeps a dynamic genre title while removing keyed presentation copy', () => {
    const presented = presentMusicMixForNativeClient(
      mix({
        subtitleKey: 'music.discovery.selection.genre.subtitle',
        subtitleArguments: [4170],
      }),
    );

    expect(presented.title).toBe('Rock');
    expect(presented).not.toHaveProperty('subtitle');
    expect(presented.subtitleKey).toBe('music.discovery.selection.genre.subtitle');
  });

  it('removes fallback text only when the matching localization key exists', () => {
    const presented = presentMusicMixForNativeClient(
      mix({
        titleKey: 'music.discovery.daily.title',
        subtitleKey: 'music.discovery.daily.subtitle',
        description: 'Fallback description',
        descriptionKey: 'music.discovery.daily.description',
      }),
    );

    expect(presented).not.toHaveProperty('title');
    expect(presented).not.toHaveProperty('subtitle');
    expect(presented).not.toHaveProperty('description');
  });

  it('keeps unkeyed fallback fields', () => {
    const presented = presentMusicMixForNativeClient(mix({ description: 'Dynamic description' }));

    expect(presented).toMatchObject({
      title: 'Rock',
      subtitle: '4170 parcalik tur seckisi',
      description: 'Dynamic description',
    });
  });
});

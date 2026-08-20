import type { MusicMixDto } from '@cinedrive/shared';

export type NativeMusicMixDto = Omit<MusicMixDto, 'title' | 'subtitle' | 'description'> &
  Partial<Pick<MusicMixDto, 'title' | 'subtitle' | 'description'>>;

/**
 * Native clients localize presentation copy from keys. Dynamic content such as
 * a genre name has no localization key, so its fallback text must stay in the
 * response.
 */
export const presentMusicMixForNativeClient = (mix: MusicMixDto): NativeMusicMixDto => {
  const { title, subtitle, description, ...localized } = mix;
  return {
    ...localized,
    ...(!mix.titleKey ? { title } : {}),
    ...(!mix.subtitleKey ? { subtitle } : {}),
    ...(!mix.descriptionKey && description !== undefined ? { description } : {}),
  };
};

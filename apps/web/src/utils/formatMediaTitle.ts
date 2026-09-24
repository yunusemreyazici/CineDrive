import { intlLocale } from '../i18n';

export const formatMediaTitle = (title: string): string =>
  title
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word.length > 1 && word === word.toLocaleUpperCase(intlLocale)) return word;
      return `${word.charAt(0).toLocaleUpperCase(intlLocale)}${word.slice(1)}`;
    })
    .join(' ');

import { tr, type Translations } from './tr';
import { en } from './en';

export type { Translations };

export type Locale = 'tr' | 'en';

const DICTIONARIES: Record<Locale, Translations> = { tr, en };

export const LOCALES = Object.keys(DICTIONARIES) as Locale[];

export const DEFAULT_LOCALE: Locale = 'tr';

const STORAGE_KEY = 'cinedrive_locale';

const isLocale = (value: string | null): value is Locale =>
  value !== null && (LOCALES as string[]).includes(value);

export const getStoredLocale = (): Locale => {
  if (typeof localStorage === 'undefined') return DEFAULT_LOCALE;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

export const locale: Locale = getStoredLocale();

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
}

/**
 * Copy for the active locale, resolved once at module load.
 *
 * Several modules build their option lists at import time — the theme picker,
 * the sort dropdown, the settings tabs — so swapping the dictionary in place
 * would leave those frozen in the previous language. Reloading after a change
 * is the honest way to keep every string in one language, and it re-runs the
 * `toLocaleLowerCase('tr-TR')` style calls under the new locale too.
 */
export const t: Translations = DICTIONARIES[locale];

export const setLocale = (next: Locale) => {
  if (next === locale) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A locale that cannot be persisted still applies to this session.
  }
  window.location.reload();
};

/** Hook form for components that would rather not import the binding directly. */
export const useTranslation = (): Translations => t;

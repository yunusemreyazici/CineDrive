import { tr, type Translations } from './tr';

export type { Translations };

export type Locale = 'tr';

const DICTIONARIES: Record<Locale, Translations> = { tr };

/**
 * The app currently ships one locale. Everything reads copy through `t`, so
 * adding a second language means adding a dictionary file and making this
 * lookup reactive (a store value plus a `useTranslation()` hook) — not touching
 * the components again.
 */
export const DEFAULT_LOCALE: Locale = 'tr';

export const t: Translations = DICTIONARIES[DEFAULT_LOCALE];

/**
 * Hook form, so components already read copy the way they will once the locale
 * becomes reactive.
 */
export const useTranslation = (): Translations => t;

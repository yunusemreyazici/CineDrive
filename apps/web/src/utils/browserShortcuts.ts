import { canonicalBrowseQuery } from '../components/media/browseState';

export const MAX_SAVED_VIEWS = 20;
export interface SavedBrowseView {
  id: string;
  name: string;
  path: '/library' | '/movies' | '/series';
  query: string;
}
export interface BrowserShortcuts {
  views: SavedBrowseView[];
  searches: string[];
}
export const emptyShortcuts = (): BrowserShortcuts => ({ views: [], searches: [] });
export const shortcutsKey = (userId: string) => `cinedrive.web-shortcuts.v1:${userId}`;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validView = (value: unknown): value is SavedBrowseView =>
  record(value) &&
  Object.keys(value).every((key) => ['id', 'name', 'path', 'query'].includes(key)) &&
  boundedText(value.id, 80) &&
  boundedText(value.name, 60) &&
  ['/library', '/movies', '/series'].includes(String(value.path)) &&
  typeof value.query === 'string' &&
  value.query.length <= 2048;

export function readShortcuts(key: string): BrowserShortcuts {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 64_000) return emptyShortcuts();
    const parsed: unknown = JSON.parse(raw);
    if (
      !record(parsed) ||
      !Object.keys(parsed).every((key) => ['views', 'searches'].includes(key)) ||
      !Array.isArray(parsed.views) ||
      parsed.views.length > MAX_SAVED_VIEWS ||
      !parsed.views.every(validView) ||
      !Array.isArray(parsed.searches) ||
      parsed.searches.length > 8 ||
      !parsed.searches.every((term) => boundedText(term, 200))
    )
      return emptyShortcuts();
    return {
      searches: parsed.searches.map((term) => term.trim()),
      views: parsed.views.map((view) => ({
        ...view,
        name: view.name.trim(),
        query: canonicalBrowseQuery(new URLSearchParams(view.query)),
      })),
    };
  } catch {
    return emptyShortcuts();
  }
}

export function rememberSearch(data: BrowserShortcuts, query: string): BrowserShortcuts {
  const term = query.trim().slice(0, 200);
  if (!term) return data;
  return {
    ...data,
    searches: [
      term,
      ...data.searches.filter((entry) => entry.toLowerCase() !== term.toLowerCase()),
    ].slice(0, 8),
  };
}

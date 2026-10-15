import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSessionQuery } from './useApi';

export interface BrowsedMedia {
  id: string;
  title: string;
  type: 'movie' | 'series';
}
export const recentBrowseKey = (id: string) => `cinedrive.recent-browse.v1:${id}`;
const eventName = 'cinedrive:recent-browse';
const LIMIT = 12;

function readRaw(key: string | null): string | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw && raw.length <= 16_000 ? raw : null;
  } catch {
    return null;
  }
}

function parseRecentBrowse(raw: string | null): BrowsedMedia[] {
  try {
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > LIMIT) return [];
    const result: BrowsedMedia[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (
        typeof row.id !== 'string' ||
        !row.id.trim() ||
        row.id.length > 200 ||
        typeof row.title !== 'string' ||
        !row.title.trim() ||
        row.title.length > 240 ||
        (row.type !== 'movie' && row.type !== 'series')
      )
        return [];
      if (!result.some((entry) => entry.id === row.id))
        result.push({ id: row.id, title: row.title, type: row.type });
    }
    return result;
  } catch {
    return [];
  }
}

export function readRecentBrowse(key: string | null): BrowsedMedia[] {
  return parseRecentBrowse(readRaw(key));
}

export function useRecentlyBrowsed() {
  const { data: session } = useSessionQuery();
  const key = session?.authenticated && session.user?.id ? recentBrowseKey(session.user.id) : null;
  const subscribe = useCallback(
    (notify: () => void) => {
      const sync = (event: Event) => {
        if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
        notify();
      };
      window.addEventListener(eventName, sync);
      window.addEventListener('storage', sync);
      return () => {
        window.removeEventListener(eventName, sync);
        window.removeEventListener('storage', sync);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => readRaw(key), [key]);
  // React rechecks the snapshot after subscribing, including writes from a
  // sibling's mount effect that occurred before this listener was installed.
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const items = useMemo(() => parseRecentBrowse(raw), [raw]);

  const update = useCallback(
    (transform: (items: BrowsedMedia[]) => BrowsedMedia[]) => {
      if (!key) return false;
      try {
        const items = transform(readRecentBrowse(key)).slice(0, LIMIT);
        if (items.length) localStorage.setItem(key, JSON.stringify(items));
        else localStorage.removeItem(key);
        window.dispatchEvent(new Event(eventName));
        return true;
      } catch {
        return false;
      }
    },
    [key],
  );
  return { key, items, update };
}

/** Render only after a detail request has succeeded; never records catalogue impressions. */
export function RememberBrowsedMedia({ media }: { media: BrowsedMedia }) {
  const { key, update } = useRecentlyBrowsed();
  const recorded = useRef<string | null>(null);
  const owner = useRef(key);
  const { id, title, type } = media;
  useEffect(() => {
    const identity = `${key}:${id}`;
    // A still-mounted detail from the old account must not be copied to the
    // newly signed-in account while its route/session is being replaced.
    if (owner.current && owner.current !== key) return;
    if (key) owner.current = key;
    if (!key || recorded.current === identity) return;
    recorded.current = identity;
    if (!id.trim() || id.length > 200 || !title.trim()) return;
    update((items) => [
      { id, title: title.slice(0, 240), type },
      ...items.filter((item) => item.id !== id),
    ]);
  }, [id, key, title, type, update]);
  return null;
}

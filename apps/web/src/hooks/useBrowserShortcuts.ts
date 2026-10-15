import { useEffect, useState } from 'react';
import { useSessionQuery } from './useApi';
import {
  emptyShortcuts,
  readShortcuts,
  shortcutsKey,
  type BrowserShortcuts,
} from '../utils/browserShortcuts';

const CHANGED_EVENT = 'cinedrive:shortcuts-changed';

/** Preferences belong to the signed-in account, never an anonymous/global fallback. */
export function useBrowserShortcuts() {
  const { data: session } = useSessionQuery();
  const key = session?.authenticated && session.user?.id ? shortcutsKey(session.user.id) : null;
  const [snapshot, setSnapshot] = useState(() => ({
    key,
    data: key ? readShortcuts(key) : emptyShortcuts(),
  }));
  if (snapshot.key !== key) setSnapshot({ key, data: key ? readShortcuts(key) : emptyShortcuts() });
  const data = snapshot.key === key ? snapshot.data : emptyShortcuts();

  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== key && event.key !== null) return;
      setSnapshot({ key, data: key ? readShortcuts(key) : emptyShortcuts() });
    };
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGED_EVENT, sync);
    };
  }, [key]);

  const update = (transform: (current: BrowserShortcuts) => BrowserShortcuts): boolean => {
    if (!key) return false;
    try {
      // Another mounted shortcut surface may have changed the other collection.
      const next = transform(readShortcuts(key));
      localStorage.setItem(key, JSON.stringify(next));
      setSnapshot({ key, data: next });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      return true;
    } catch {
      return false;
    }
  };
  return { data, update, available: key !== null };
}

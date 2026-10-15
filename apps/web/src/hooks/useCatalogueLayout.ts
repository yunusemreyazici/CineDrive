import { useEffect, useState } from 'react';
import { useSessionQuery } from './useApi';

export type CatalogueLayout = {
  mode: 'grid' | 'list';
  size: 'small' | 'medium' | 'large';
};
const defaults: CatalogueLayout = { mode: 'grid', size: 'medium' };
const changed = 'cinedrive:catalogue-layout';
export const catalogueLayoutKey = (id: string) => `cinedrive.catalogue-layout.v1:${id}`;

function read(key: string | null): CatalogueLayout {
  if (!key) return defaults;
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 256) return defaults;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return defaults;
    const candidate = value as Record<string, unknown>;
    return {
      mode: candidate.mode === 'list' ? 'list' : 'grid',
      size: candidate.size === 'small' || candidate.size === 'large' ? candidate.size : 'medium',
    };
  } catch {
    return defaults;
  }
}

/** Local presentation only: never changes API pagination or a saved filter URL. */
export function useCatalogueLayout() {
  const { data: session } = useSessionQuery();
  const key =
    session?.authenticated && session.user?.id ? catalogueLayoutKey(session.user.id) : null;
  const [snapshot, setSnapshot] = useState(() => ({ key, value: read(key), failed: false }));
  if (snapshot.key !== key) setSnapshot({ key, value: read(key), failed: false });
  const value = snapshot.key === key ? snapshot.value : defaults;

  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
      setSnapshot({ key, value: read(key), failed: false });
    };
    window.addEventListener('storage', sync);
    window.addEventListener(changed, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(changed, sync);
    };
  }, [key]);

  const update = (patch: Partial<CatalogueLayout>) => {
    if (!key) return;
    const next = { ...value, ...patch };
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setSnapshot({ key, value: next, failed: false });
      window.dispatchEvent(new Event(changed));
    } catch {
      // Still usable for this mounted page; do not promise persistence.
      setSnapshot({ key, value: next, failed: true });
    }
  };
  return {
    ...value,
    update,
    available: key !== null,
    failed: snapshot.key === key && snapshot.failed,
    gridClassName: `cd-catalogue-grid cd-catalogue-${value.size}`,
  };
}

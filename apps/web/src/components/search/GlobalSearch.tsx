import { lazy, Suspense, useEffect } from 'react';
import { useUiStore } from '../../stores/useUiStore';
import { t } from '../../i18n';

const SearchDialog = lazy(() =>
  import('./SearchDialog').then((module) => ({ default: module.SearchDialog })),
);

/** One shortcut handler across film and music routes; load search only on demand. */
export function GlobalSearch() {
  const open = useUiStore((state) => state.searchOpen);
  const setOpen = useUiStore((state) => state.setSearchOpen);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.repeat) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [setOpen]);
  if (!open) return null;
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="fixed right-4 top-4 z-[90] rounded-xl bg-zinc-900 px-4 py-3 text-sm"
        >
          {t.common.loading}
        </div>
      }
    >
      <SearchDialog onClose={() => setOpen(false)} />
    </Suspense>
  );
}

import { Film, Tv, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRecentlyBrowsed } from '../../hooks/useRecentlyBrowsed';
import { t } from '../../i18n';
import { toast } from '../../stores/useToastStore';

export function RecentlyBrowsed() {
  const { items, update } = useRecentlyBrowsed();
  if (!items.length) return null;
  const clear = (id?: string) => {
    if (!update((current) => (id ? current.filter((item) => item.id !== id) : [])))
      toast.error(t.recentBrowse.clearFailed);
  };
  return (
    <section aria-label={t.recentBrowse.title} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="cd-section-title font-display">{t.recentBrowse.title}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t.recentBrowse.hint}</p>
        </div>
        <button type="button" className="cd-pill-link" onClick={() => clear()}>
          {t.recentBrowse.clear}
        </button>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {items.map((item) => {
          const Icon = item.type === 'movie' ? Film : Tv;
          return (
            <li
              key={item.id}
              className="flex w-64 shrink-0 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
            >
              <Link
                to={`/media/${encodeURIComponent(item.id)}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md"
              >
                <Icon className="h-5 w-5 shrink-0 text-brand-400" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{item.title}</span>
                  <span className="text-xs text-zinc-500">
                    {item.type === 'movie' ? t.common.movie : t.common.series}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                aria-label={t.recentBrowse.remove(item.title)}
                className="shrink-0 rounded-lg p-2 text-zinc-400 hover:text-white"
                onClick={() => clear(item.id)}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

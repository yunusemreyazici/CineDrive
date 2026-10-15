import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookmarkPlus, Check, Link2, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useBrowserShortcuts } from '../../hooks/useBrowserShortcuts';
import { MAX_SAVED_VIEWS, type SavedBrowseView } from '../../utils/browserShortcuts';
import { canonicalBrowseQuery } from './browseState';
import { toast } from '../../stores/useToastStore';
import { t } from '../../i18n';

export function SavedBrowseViews() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, update, available } = useBrowserShortcuts();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const path = location.pathname as SavedBrowseView['path'];
  const query = canonicalBrowseQuery(new URLSearchParams(location.search));
  const saved = data.views.some((view) => view.path === path && view.query === query);
  const atLimit = data.views.length >= MAX_SAVED_VIEWS;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || atLimit || !available) return;
    const persisted = update((current) => {
      if (
        current.views.length >= MAX_SAVED_VIEWS ||
        current.views.some((view) => view.path === path && view.query === query)
      )
        return current;
      return {
        ...current,
        views: [
          ...current.views,
          {
            id: crypto.randomUUID(),
            name: name.trim().slice(0, 60),
            path,
            query,
          },
        ],
      };
    });
    if (!persisted) {
      setError(t.shortcuts.storageFailed);
      return;
    }
    setEditing(false);
    toast.success(t.shortcuts.saved);
  };

  const copy = async () => {
    const suffix = query ? `?${query}` : '';
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}${suffix}`);
      toast.success(t.shortcuts.linkCopied);
    } catch {
      toast.error(t.shortcuts.copyFailed);
    }
  };

  return (
    <section aria-label={t.shortcuts.views} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="cd-pill-link"
          disabled={!available || saved || atLimit}
          title={atLimit ? t.shortcuts.limit : undefined}
          onClick={() => {
            setEditing(true);
            setName('');
            setError('');
          }}
        >
          {saved ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
          {saved ? t.shortcuts.saved : t.shortcuts.saveView}
        </button>
        <button type="button" className="cd-pill-link" onClick={() => void copy()}>
          <Link2 className="h-4 w-4" />
          {t.shortcuts.copyLink}
        </button>
        <p className="text-xs text-zinc-500">
          {atLimit ? t.shortcuts.limit : t.shortcuts.localHint}
        </p>
      </div>
      {data.views.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t.shortcuts.views}>
          {data.views.map((view) => (
            <li
              key={view.id}
              className="flex min-w-0 max-w-full items-center rounded-full border border-zinc-800 bg-zinc-900"
            >
              <button
                type="button"
                className="truncate rounded-l-full px-3 py-2 text-xs text-zinc-200 hover:text-brand-300"
                aria-pressed={view.path === path && view.query === query}
                onClick={() => navigate(`${view.path}${view.query ? `?${view.query}` : ''}`)}
              >
                {view.name}
              </button>
              <button
                type="button"
                className="shrink-0 rounded-r-full p-2 text-zinc-500 hover:text-white"
                aria-label={t.shortcuts.removeView(view.name)}
                onClick={() => {
                  if (
                    !update((current) => ({
                      ...current,
                      views: current.views.filter((item) => item.id !== view.id),
                    }))
                  )
                    toast.error(t.shortcuts.storageFailed);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title={t.shortcuts.saveView}
        size="sm"
        description={t.shortcuts.localHint}
      >
        <form onSubmit={save} className="space-y-4 p-6">
          <label className="block space-y-2 text-sm text-zinc-300">
            <span>{t.shortcuts.viewName}</span>
            <input
              className="cd-field w-full px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
              placeholder={t.shortcuts.nameExample}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <button type="submit" disabled={!name.trim() || atLimit} className="cd-primary">
            {t.common.save}
          </button>
        </form>
      </Modal>
    </section>
  );
}

import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Search, ChevronRight } from 'lucide-react';
import { AccountSection } from './settings/sections/AccountSection';
import { InterfaceSection } from './settings/sections/InterfaceSection';
import { LibrarySourcesSection } from './settings/sections/LibrarySourcesSection';
import { OpenSubtitlesSection } from './settings/sections/OpenSubtitlesSection';
import { t } from '../i18n';
import {
  SETTINGS_GROUPS,
  SETTINGS_SEARCH_ITEMS,
  resolvePane,
  type SettingsPane,
  type SettingsSearchItem,
} from './settings/settingsNavigation';

const MediaManagerPage = React.lazy(() =>
  import('./MediaManagerPage').then((module) => ({ default: module.MediaManagerPage })),
);
const InsightsPage = React.lazy(() =>
  import('./InsightsPage').then((module) => ({ default: module.InsightsPage })),
);
const MediaHealthPage = React.lazy(() =>
  import('./MediaHealthPage').then((module) => ({ default: module.MediaHealthPage })),
);

const MAX_SEARCH_RESULTS = 6;

const SettingsToolFallback: React.FC = () => (
  <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-zinc-500">
    <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
    {t.settings.sectionLoading}
  </div>
);

/** The maintenance tools are heavy pages; only the visible one is mounted. */
const PANE_CONTENT: Record<SettingsPane, React.ReactNode> = {
  profile: <AccountSection />,
  appearance: <InterfaceSection />,
  libraries: <LibrarySourcesSection />,
  openSubtitles: <OpenSubtitlesSection />,
  manage: <MediaManagerPage />,
  storage: <InsightsPage />,
  health: <MediaHealthPage />,
};

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsSearch, setSettingsSearch] = useState('');

  const activePane = resolvePane(searchParams.get('tab'));
  const normalizedSearch = settingsSearch.trim().toLocaleLowerCase('tr-TR');

  const searchResults = useMemo(
    () =>
      normalizedSearch
        ? SETTINGS_SEARCH_ITEMS.filter((item) =>
            `${item.label} ${item.description}`
              .toLocaleLowerCase('tr-TR')
              .includes(normalizedSearch),
          ).slice(0, MAX_SEARCH_RESULTS)
        : [],
    [normalizedSearch],
  );

  const selectPane = (pane: SettingsPane) => {
    setSearchParams(pane === 'profile' ? {} : { tab: pane });
  };

  const openSearchResult = (item: SettingsSearchItem) => {
    selectPane(item.pane);
    setSettingsSearch('');
  };

  return (
    <div>
      <header className="mb-5 flex flex-col gap-4 border-b border-zinc-800/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">
            {t.settings.title}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400">{t.settings.subtitle}</p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={settingsSearch}
            onChange={(event) => setSettingsSearch(event.target.value)}
            placeholder={t.settings.searchLabel}
            aria-label={t.settings.searchLabel}
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 pl-9 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-brand-500/70"
          />
          {normalizedSearch ? (
            <div className="absolute right-0 top-12 z-30 w-full min-w-72 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60">
              {searchResults.length > 0 ? (
                searchResults.map((item) => (
                  <button
                    key={`${item.pane}-${item.label}`}
                    type="button"
                    onClick={() => openSearchResult(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-zinc-900 focus:outline-none focus-visible:bg-zinc-900"
                  >
                    <span>
                      <span className="block text-[13px] font-medium text-zinc-100">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-500">
                        {item.description}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                  </button>
                ))
              ) : (
                <p className="px-3 py-4 text-center text-xs text-zinc-500">
                  {t.settings.noSearchResults}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/25 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-visible">
        <nav
          aria-label={t.settings.sectionsLabel}
          className="scrollbar-none flex gap-4 overflow-x-auto border-b border-zinc-800/80 bg-zinc-950/60 p-2 lg:sticky lg:top-24 lg:block lg:min-h-[calc(100vh-10rem)] lg:self-start lg:border-b-0 lg:border-r lg:p-3"
        >
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="shrink-0 lg:mb-4 lg:shrink">
              <p className="hidden px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 lg:block">
                {group.label}
              </p>
              <ul className="flex gap-1 lg:block lg:space-y-0.5">
                {group.panes.map((pane) => {
                  const Icon = pane.icon;
                  const isActive = activePane === pane.id;

                  return (
                    <li key={pane.id}>
                      <button
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => selectPane(pane.id)}
                        className={`flex w-full min-w-max items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                          isActive
                            ? 'bg-brand-500/10 font-medium text-brand-300'
                            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-400' : 'text-zinc-500'}`}
                        />
                        {pane.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 p-4 md:px-7 md:py-5">
          <Suspense fallback={<SettingsToolFallback />}>{PANE_CONTENT[activePane]}</Suspense>
        </div>
      </div>
    </div>
  );
};

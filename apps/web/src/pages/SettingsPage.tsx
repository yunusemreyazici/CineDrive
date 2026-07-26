import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Search, ChevronRight } from 'lucide-react';
import { GeneralSettingsTab } from './settings/GeneralSettingsTab';
import { t } from '../i18n';
import {
  SETTINGS_TABS,
  SETTINGS_SEARCH_ITEMS,
  isSettingsTab,
  type SettingsSearchItem,
  type SettingsTab,
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
/** Long enough for the tab to render before we scroll to the anchor. */
const SCROLL_TO_SECTION_DELAY_MS = 80;

const SettingsToolFallback: React.FC = () => (
  <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-zinc-500">
    <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
    {t.settings.sectionLoading}
  </div>
);

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsSearch, setSettingsSearch] = useState('');

  const requestedTab = searchParams.get('tab');
  const activeTab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : 'general';
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

  const selectTab = (tab: SettingsTab) => {
    setSearchParams(tab === 'general' ? {} : { tab });
  };

  const openSearchResult = (item: SettingsSearchItem) => {
    selectTab(item.tab);
    setSettingsSearch('');
    if (!item.targetId) return;

    window.setTimeout(() => {
      document
        .getElementById(item.targetId!)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, SCROLL_TO_SECTION_DELAY_MS);
  };

  return (
    <div>
      <header className="mb-5 flex flex-col gap-4 border-b border-zinc-800/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">{t.settings.title}</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            {t.settings.subtitle}
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={settingsSearch}
            onChange={(event) => setSettingsSearch(event.target.value)}
            placeholder={t.settings.searchLabel}
            aria-label={t.settings.searchLabel}
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 pl-9 pr-3 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-brand-500/70"
          />
          {normalizedSearch ? (
            <div className="absolute right-0 top-12 z-30 w-full min-w-72 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60">
              {searchResults.length > 0 ? (
                searchResults.map((item) => (
                  <button
                    key={`${item.tab}-${item.label}`}
                    type="button"
                    onClick={() => openSearchResult(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-zinc-900 focus:outline-none focus-visible:bg-zinc-900"
                  >
                    <span>
                      <span className="block text-xs font-semibold text-zinc-100">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">
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

      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/25 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-visible">
        <div
          role="tablist"
          aria-label={t.settings.sectionsLabel}
          className="scrollbar-none flex gap-1 overflow-x-auto border-b border-zinc-800/80 bg-zinc-950/60 p-2 lg:sticky lg:top-24 lg:block lg:min-h-[calc(100vh-10rem)] lg:space-y-1 lg:self-start lg:border-b-0 lg:border-r lg:p-3"
        >
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="settings-tabpanel"
                onClick={() => selectTab(tab.id)}
                className={`group flex min-w-max items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:w-full ${
                  isActive
                    ? 'border-brand-500/30 bg-brand-500/10 text-brand-300'
                    : 'border-transparent text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100'
                }`}
              >
                <Icon
                  className={`h-5 w-5 shrink-0 ${
                    isActive ? 'text-brand-400' : 'text-zinc-500 group-hover:text-zinc-300'
                  }`}
                />
                <span>
                  <span className="block text-xs font-semibold">{tab.label}</span>
                  <span className="mt-0.5 hidden text-[10px] font-normal leading-4 text-zinc-500 lg:block">
                    {tab.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div id="settings-tabpanel" role="tabpanel" className="min-w-0 p-3 md:p-5">
          {activeTab === 'general' ? <GeneralSettingsTab /> : null}
          <Suspense fallback={<SettingsToolFallback />}>
            {activeTab === 'manage' ? <MediaManagerPage /> : null}
            {activeTab === 'storage' ? <InsightsPage /> : null}
            {activeTab === 'health' ? <MediaHealthPage /> : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

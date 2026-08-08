import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Disc3, Film, Loader2, Music2, Search, Tv, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { MusicAlbumDto, MusicArtistDto, MusicTrackDto } from '@cinedrive/shared';
import { useMediaListQuery } from '../../hooks/useApi';
import { apiClient } from '../../api/client';
import { getPosterUrl } from '../../utils/mediaImages';
import { t } from '../../i18n';

/**
 * The search overlay ⌘K always claimed to open.
 *
 * The navbar advertised the shortcut but only moved focus into a text field
 * that did nothing until Enter, and the field itself was `hidden sm:block` —
 * so on a phone the library could not be searched at all. This dialog is the
 * one entry point for both.
 */

const SEARCH_DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;

interface SearchDialogProps {
  onClose: () => void;
}

/**
 * Mounted only while open, so every invocation starts empty without an effect
 * reaching back to clear its own state.
 */
export const SearchDialog: React.FC<SearchDialogProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmedQuery = debouncedQuery.trim();
  const { data, isFetching } = useMediaListQuery(
    { search: trimmedQuery, limit: MAX_RESULTS },
    { enabled: trimmedQuery.length > 0 },
  );
  const musicQuery = useQuery({
    queryKey: ['music', 'search', trimmedQuery],
    enabled: trimmedQuery.length > 0,
    queryFn: async () => (await apiClient.get<{ tracks: MusicTrackDto[]; albums: MusicAlbumDto[]; artists: MusicArtistDto[] }>('/music/search', { params: { q: trimmedQuery } })).data,
  });

  // Adjusting state during render rather than in an effect: a new query always
  // starts from the first result, and React re-renders before painting.
  const [lastQuery, setLastQuery] = useState(trimmedQuery);
  if (trimmedQuery !== lastQuery) {
    setLastQuery(trimmedQuery);
    setActiveIndex(0);
  }

  const results = useMemo(() => {
    if (!trimmedQuery) return [];
    return [
      ...(data?.media || []).map((media) => ({ id: `media-${media.id}`, title: media.title, subtitle: `${media.type === 'movie' ? t.common.movie : t.common.series}${media.year ? ` · ${media.year}` : ''}`, image: getPosterUrl(media), kind: media.type as 'movie' | 'series', path: `/media/${media.id}` })),
      ...(musicQuery.data?.tracks || []).map((track) => ({ id: `track-${track.id}`, title: track.title, subtitle: `${t.music.tracks} · ${track.primaryArtist?.name || ''}`, image: track.artworkUrl, kind: 'track' as const, path: `/music/albums/${track.album?.id || ''}` })),
      ...(musicQuery.data?.albums || []).map((album) => ({ id: `album-${album.id}`, title: album.title, subtitle: `${t.music.album} · ${album.artist?.name || ''}`, image: album.artworkUrl, kind: 'album' as const, path: `/music/albums/${album.id}` })),
      ...(musicQuery.data?.artists || []).map((artist) => ({ id: `artist-${artist.id}`, title: artist.name, subtitle: t.music.artist, image: artist.artworkUrl, kind: 'artist' as const, path: `/music/artists/${artist.id}` })),
    ].slice(0, 14);
  }, [data, musicQuery.data, trimmedQuery]);

  // Keystrokes stay instant while the query only reaches the API once typing
  // settles — the same rule the library search follows.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, []);

  const openResult = (index: number) => {
    const result = results[index];
    if (!result) return;
    onClose();
    navigate(result.path);
  };

  const openLibrarySearch = () => {
    onClose();
    navigate(`/library?search=${encodeURIComponent(trimmedQuery)}`);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Enter on an empty selection still gets the user somewhere useful.
      if (results.length > 0) openResult(activeIndex);
      else if (trimmedQuery) openLibrarySearch();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label={t.common.close}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.search.dialogLabel}
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              results.length > 0 ? `${listId}-option-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-label={t.search.dialogLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.search.placeholder}
            className="h-12 flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          {(isFetching || musicQuery.isFetching) && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" />}
        </div>

        {trimmedQuery.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-zinc-500">{t.search.hint}</p>
        ) : results.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-zinc-500">
            {isFetching ? t.search.searching : t.search.noResults(trimmedQuery)}
          </p>
        ) : (
          <ul id={listId} role="listbox" aria-label={t.search.dialogLabel} className="max-h-80 overflow-y-auto p-1.5">
            {results.map((result, index) => {
              const isActive = index === activeIndex;

              return (
                <li key={result.id} role="none">
                  <button
                    type="button"
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => openResult(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive ? 'bg-zinc-800/80' : ''
                    }`}
                  >
                    <span className="h-14 w-10 shrink-0 overflow-hidden rounded bg-zinc-900">
                      {result.image ? (
                        <img src={result.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-zinc-600">
                          {result.kind === 'movie' ? <Film className="h-4 w-4" /> : result.kind === 'series' ? <Tv className="h-4 w-4" /> : result.kind === 'artist' ? <UserRound className="h-4 w-4" /> : result.kind === 'album' ? <Disc3 className="h-4 w-4" /> : <Music2 className="h-4 w-4" />}
                        </span>
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-zinc-100">
                        {result.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-zinc-500">
                        {result.subtitle}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-4 py-2.5">
          {trimmedQuery && results.length > 0 ? (
            <button
              type="button"
              onClick={openLibrarySearch}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t.search.seeAll}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="text-xs text-zinc-600">
              {results.length > 0 ? t.search.resultCount(results.length) : ''}
            </span>
          )}

          <span className="hidden shrink-0 items-center gap-2 text-[11px] text-zinc-600 sm:flex">
            <kbd className="rounded border border-zinc-700 px-1">↑↓</kbd>
            {t.search.navigateHint}
            <kbd className="rounded border border-zinc-700 px-1">↵</kbd>
            {t.search.openHint}
            <kbd className="rounded border border-zinc-700 px-1">esc</kbd>
            {t.search.closeHint}
          </span>
        </div>
      </div>
    </div>
  );
};

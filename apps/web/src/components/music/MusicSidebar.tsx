import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  BarChart3,
  Disc3,
  Heart,
  History,
  Home,
  ListMusic,
  Loader2,
  Menu,
  Music2,
  Plus,
  Radio,
  Search,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Modal } from '../common/Modal';
import { useCreateMusicPlaylistMutation, useMusicPlaylistsQuery } from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { toast } from '../../stores/useToastStore';
import { useUiStore } from '../../stores/useUiStore';

interface MusicNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  hash?: string;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

const discoveryItems: MusicNavItem[] = [
  { to: '/music', label: t.music.musicHome, icon: Home, end: true },
  { to: '/music/mixes', label: t.music.mixesRadio, icon: Radio },
];

const personalItems: MusicNavItem[] = [
  { to: '/music/liked', label: t.music.liked, icon: Heart },
  { to: '/music/history', label: t.music.history, icon: History },
  { to: '/music/replay', label: t.music.replay, icon: BarChart3 },
];

const libraryItems: MusicNavItem[] = [
  { to: '/music/artists', label: t.music.artists, icon: UserRound },
  { to: '/music/albums', label: t.music.albums, icon: Disc3 },
  { to: '/music/tracks', label: t.music.tracks, icon: Music2 },
  { to: '/music/maintenance', label: t.music.libraryCare, icon: Wrench },
];

const MusicNavSection: React.FC<{
  title: string;
  items: MusicNavItem[];
  onNavigate?: () => void;
}> = ({ title, items, onNavigate }) => {
  const location = useLocation();

  return (
    <section className="space-y-2">
      <h2 className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
        {title}
      </h2>
      <nav className="space-y-1" aria-label={title}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => {
              const selected = item.hash
                ? location.pathname === '/music' && location.hash === item.hash
                : isActive && !(item.to === '/music' && location.hash);
              return `flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                selected
                  ? 'bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]'
                  : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
              }`;
            }}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </section>
  );
};

export const MusicSidebar: React.FC = () => {
  const navigate = useNavigate();
  const setMainSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const playlistsQuery = useMusicPlaylistsQuery();
  const createPlaylist = useCreateMusicPlaylistMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [search, setSearch] = useState('');
  const [sortAscending, setSortAscending] = useState(true);
  const [mobileMusicOpen, setMobileMusicOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  );
  const playlists = useMemo(
    () =>
      [...(playlistsQuery.data || [])].sort((left, right) => {
        const comparison = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        return sortAscending ? comparison : -comparison;
      }),
    [playlistsQuery.data, sortAscending],
  );

  const closeCreateModal = () => {
    if (createPlaylist.isPending) return;
    setCreateOpen(false);
    setPlaylistName('');
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const sync = (event: MediaQueryList | MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!mobileMusicOpen || isDesktop) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMusicOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDesktop, mobileMusicOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-white/[0.07] bg-[#090a0c]/95 px-3 shadow-[0_12px_35px_rgba(0,0,0,.24)] backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => {
            setMobileMusicOpen(false);
            setMainSidebarOpen(true);
          }}
          aria-label={t.nav.toggleMenu}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link
          to="/music"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
            <Music2 className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-bold text-white">
              {t.music.title}
            </span>
            <span className="block truncate text-[10px] text-zinc-600">
              {t.music.yourCollection}
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => navigate('/music/tracks')}
          aria-label={t.music.searchMusic}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setMobileMusicOpen(true)}
          aria-label={t.music.musicNavigation}
          aria-expanded={mobileMusicOpen}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <ListMusic className="h-5 w-5" />
        </button>
      </header>

      {mobileMusicOpen && (
        <button
          type="button"
          aria-label={t.common.close}
          onClick={() => setMobileMusicOpen(false)}
          className="fixed inset-0 z-[64] cursor-default bg-black/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        aria-label={t.music.musicNavigation}
        aria-hidden={!isDesktop && !mobileMusicOpen ? true : undefined}
        inert={!isDesktop && !mobileMusicOpen ? true : undefined}
        className={`fixed bottom-0 left-0 top-0 z-[65] flex w-[min(320px,calc(100vw-32px))] flex-col border-r border-white/[0.06] bg-[#0b0c0e]/98 shadow-[24px_0_70px_rgba(0,0,0,.32)] backdrop-blur-xl transition-[left,transform] duration-300 lg:left-[var(--app-sidebar-offset,220px)] lg:z-30 lg:w-[272px] lg:translate-x-0 lg:bg-[#0b0c0e]/95 ${
          mobileMusicOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-white/[0.06] px-4 pb-4 pt-4">
          <div className="mb-3 flex h-9 items-center gap-2 px-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
              <Music2 className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="font-display text-sm font-bold text-white">{t.music.title}</p>
              <p className="text-[10px] text-zinc-600">{t.music.yourCollection}</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileMusicOpen(false)}
              aria-label={t.common.close}
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const query = search.trim();
              setMobileMusicOpen(false);
              navigate(
                query ? `/music/tracks?search=${encodeURIComponent(query)}` : '/music/tracks',
              );
            }}
            role="search"
          >
            <label className="flex h-10 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 text-zinc-500 transition focus-within:border-brand-400/60 focus-within:text-zinc-300">
              <Search className="h-4 w-4 shrink-0" />
              <span className="sr-only">{t.music.searchMusic}</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t.music.searchMusic}
                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600"
              />
            </label>
          </form>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-color:rgb(63_63_70)_transparent] [scrollbar-width:thin]">
          <MusicNavSection
            title={t.music.discover}
            items={discoveryItems}
            onNavigate={() => setMobileMusicOpen(false)}
          />
          <MusicNavSection
            title={t.music.yourMusic}
            items={personalItems}
            onNavigate={() => setMobileMusicOpen(false)}
          />
          <MusicNavSection
            title={t.music.musicLibrary}
            items={libraryItems}
            onNavigate={() => setMobileMusicOpen(false)}
          />

          <section
            className="border-t border-white/[0.07] pt-4"
            aria-labelledby="music-playlists-title"
          >
            <div className="flex items-center justify-between px-2">
              <h2
                id="music-playlists-title"
                className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600"
              >
                {t.music.playlists}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  aria-label={t.music.createPlaylist}
                  title={t.music.createPlaylist}
                  className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSortAscending((ascending) => !ascending)}
                  aria-label={t.music.sortPlaylists}
                  aria-pressed={!sortAscending}
                  title={t.music.sortPlaylists}
                  className={`rounded-lg p-1.5 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    sortAscending ? 'text-zinc-500' : 'text-brand-400'
                  }`}
                >
                  <ArrowUpDown className="h-4 w-4" />
                </button>
              </div>
            </div>

            <nav aria-label={t.music.playlists} className="mt-2 space-y-1">
              {playlistsQuery.isLoading ? (
                <div className="flex h-10 items-center justify-center text-zinc-600">
                  <Loader2 className="h-4 w-4 animate-spin" aria-label={t.common.loading} />
                </div>
              ) : playlists.length ? (
                playlists.map((playlist) => (
                  <NavLink
                    key={playlist.id}
                    to={`/music/playlists/${playlist.id}`}
                    title={playlist.name}
                    onClick={() => setMobileMusicOpen(false)}
                    className={({ isActive }) =>
                      `group flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                        isActive
                          ? 'bg-brand-500/10 text-brand-300'
                          : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
                      }`
                    }
                  >
                    <ListMusic className="h-[18px] w-[18px] shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                    <span className="text-[10px] tabular-nums text-zinc-700 group-hover:text-zinc-500">
                      {playlist.itemCount}
                    </span>
                  </NavLink>
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="w-full rounded-xl border border-dashed border-white/[0.08] px-3 py-3 text-left text-xs leading-relaxed text-zinc-600 transition hover:border-white/15 hover:bg-white/[0.03] hover:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {t.music.noPlaylists}
                </button>
              )}
            </nav>
          </section>
        </div>
      </aside>

      <Modal
        isOpen={createOpen}
        onClose={closeCreateModal}
        title={t.music.createPlaylist}
        icon={<ListMusic className="h-5 w-5 text-brand-400" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={createPlaylist.isPending}
              className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-400 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              form="music-sidebar-create-playlist"
              disabled={!playlistName.trim() || createPlaylist.isPending}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createPlaylist.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.music.create}
            </button>
          </div>
        }
      >
        <form
          id="music-sidebar-create-playlist"
          onSubmit={(event) => {
            event.preventDefault();
            const name = playlistName.trim();
            if (!name) return;
            createPlaylist.mutate(
              { name },
              {
                onSuccess: (playlist) => {
                  setCreateOpen(false);
                  setPlaylistName('');
                  toast.success(t.music.playlistCreated);
                  navigate(`/music/playlists/${playlist.id}`);
                },
                onError: (error) => toast.fromError(error),
              },
            );
          }}
          className="space-y-2 p-6"
        >
          <label
            htmlFor="music-sidebar-playlist-name"
            className="text-xs font-semibold text-zinc-300"
          >
            {t.music.playlistName}
          </label>
          <input
            id="music-sidebar-playlist-name"
            value={playlistName}
            onChange={(event) => setPlaylistName(event.target.value)}
            placeholder={t.music.newPlaylist}
            autoComplete="off"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
          />
        </form>
      </Modal>
    </>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Home, FolderGit2, Film, Tv, Headphones, Heart, History, Settings, X } from 'lucide-react';
import { useUiStore } from '../../stores/useUiStore';
import { t } from '../../i18n';

const DESKTOP_QUERY = '(min-width: 1024px)';

const navItems = [
  { to: '/', label: t.nav.home, icon: Home },
  { to: '/library', label: t.nav.library, icon: FolderGit2 },
  { to: '/movies', label: t.nav.movies, icon: Film },
  { to: '/series', label: t.nav.series, icon: Tv },
  { to: '/music', label: t.nav.music, icon: Headphones },
  { to: '/favorites', label: t.nav.favorites, icon: Heart },
  { to: '/history', label: t.nav.history, icon: History },
  { to: '/settings', label: t.nav.settings, icon: Settings },
];

export const Sidebar: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { sidebarOpen, sidebarCollapsed: savedCollapsed, setSidebarOpen } = useUiStore();
  const sidebarCollapsed = compact ?? savedCollapsed;
  const asideRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  );

  // Below the desktop breakpoint the sidebar is an overlay drawer. It has to be
  // taken out of the tab order while hidden, and Escape has to close it.
  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    const sync = (event: MediaQueryList | MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || isDesktop) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDesktop, setSidebarOpen, sidebarOpen]);

  return (
    <>
      {/* Mobile backdrop overlay — a button so it can be dismissed without a mouse */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label={t.nav.closeMenu}
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-[69] cursor-default bg-zinc-950/80 backdrop-blur-sm transition-opacity lg:hidden"
        />
      )}

      {/* Sidebar Navigation Drawer */}
      <aside
        ref={asideRef}
        aria-label={t.nav.mainNavigation}
        aria-hidden={!sidebarOpen && !isDesktop}
        inert={!sidebarOpen && !isDesktop ? true : undefined}
        className={`cd-sidebar fixed left-0 top-0 z-[70] flex h-dvh w-[240px] flex-col border-r p-4 transition-[width,transform] duration-300 ease-in-out lg:z-50 ${
          sidebarCollapsed ? 'lg:w-[80px]' : 'lg:w-[240px]'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-28">
          <div className="mb-10 flex h-12 items-center justify-between">
            <Link to="/" aria-label="CineDrive" className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-zinc-950">
                <Film className="h-[18px] w-[18px]" />
              </div>
              <span
                className={`font-display text-lg font-bold tracking-tight text-white ${sidebarCollapsed ? 'lg:hidden' : ''}`}
              >
                CineDrive
              </span>
            </Link>
            <button
              ref={closeButtonRef}
              onClick={() => setSidebarOpen(false)}
              aria-label={t.nav.closeMenu}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav Items */}
          <p className={`cd-eyebrow mb-4 px-3 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{t.design.collection}</p>
          <nav aria-label={t.nav.mainNavigation}>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={`cd-nav-link ${item.to === '/favorites' || item.to === '/settings' ? 'cd-nav-divider' : ''}`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
};

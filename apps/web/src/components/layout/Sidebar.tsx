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

export const Sidebar: React.FC = () => {
  const { sidebarOpen, sidebarCollapsed, setSidebarOpen } = useUiStore();
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
          className="fixed inset-0 z-40 cursor-default bg-zinc-950/80 backdrop-blur-sm transition-opacity lg:hidden"
        />
      )}

      {/* Sidebar Navigation Drawer */}
      <aside
        ref={asideRef}
        aria-label={t.nav.mainNavigation}
        aria-hidden={!sidebarOpen && !isDesktop}
        inert={!sidebarOpen && !isDesktop ? true : undefined}
        className={`fixed left-0 top-0 z-50 flex h-screen w-[220px] flex-col border-r border-white/[0.06] bg-[#090a0c]/98 p-3 transition-[width,transform] duration-300 ease-in-out lg:bg-[#090a0c] ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[220px]'
        } ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="min-h-0 flex-1">
          <div className="mb-5 flex h-12 items-center justify-between px-2">
            <Link to="/" className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-500/25 bg-brand-500/10 text-brand-400">
                <Film className="h-[18px] w-[18px]" />
              </div>
              <span className={`font-display text-lg font-bold tracking-tight text-white ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
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
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex h-11 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition-all ${
                    isActive
                      ? 'border-brand-500/25 bg-brand-500/10 text-brand-400'
                      : 'border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
                  }`
                }
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

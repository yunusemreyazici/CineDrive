import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, User, LogOut, Settings, Dices } from 'lucide-react';
import { useUiStore } from '../../stores/useUiStore';
import { useSessionQuery, useLogoutMutation } from '../../hooks/useApi';
import { RandomPickerModal } from '../media/RandomPickerModal';
import { t } from '../../i18n';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { toggleSidebar, toggleSidebarCollapsed } = useUiStore();
  const { data: session } = useSessionQuery();
  const logoutMutation = useLogoutMutation();

  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showRandomModal, setShowRandomModal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase('tr-TR') === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  // The menu used to stay open until its trigger was clicked again — clicking
  // elsewhere or pressing Escape left it hanging over the page.
  useEffect(() => {
    if (!userMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current?.contains(target) || userMenuButtonRef.current?.contains(target)) {
        return;
      }
      setUserMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setUserMenuOpen(false);
      userMenuButtonRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [userMenuOpen]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/library?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => navigate('/login'),
    });
  };

  return (
    <header className="sticky top-0 z-40 flex h-[72px] w-full items-center justify-between gap-4 border-b border-white/[0.06] bg-[#070809]/90 px-4 backdrop-blur-xl md:px-6">
      <div className="flex shrink-0 items-center">
        <button
          onClick={() => {
            if (window.matchMedia('(min-width: 1024px)').matches) toggleSidebarCollapsed();
            else toggleSidebar();
          }}
          aria-label={t.nav.toggleMenu}
          className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Middle section: Global Search Bar */}
      <form onSubmit={handleSearchSubmit} className="hidden w-full max-w-xl sm:block">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.nav.searchPlaceholder}
            className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#111214] pl-10 pr-14 text-sm text-zinc-100 placeholder-zinc-500 transition-all focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">
            ⌘ K
          </kbd>
        </div>
      </form>

      {/* Right section: Ne Izlesem button & User profile & Menu */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowRandomModal(true)}
          className="flex items-center gap-2 rounded-xl border border-brand-400/25 bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_hsl(var(--brand-900)/0.28)] transition-all hover:bg-brand-500"
          title={t.nav.randomPickTitle}
        >
          <Dices className="w-4 h-4 text-brand-400" />
          <span className="hidden md:inline">{t.nav.randomPickLabel}</span>
        </button>

        <div className="relative">
          <button
            ref={userMenuButtonRef}
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label={t.nav.userMenu}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex items-center gap-2.5 p-1.5 rounded-full hover:bg-zinc-900 text-zinc-300 transition-colors focus:ring-2 focus:ring-brand-500 focus:outline-none"
          >
            <div className="w-9 h-9 rounded-full bg-brand-600/20 border border-brand-500/30 text-brand-400 flex items-center justify-center font-bold text-sm">
              {session?.user?.name ? session.user.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
            </div>
          </button>

          {userMenuOpen && (
            <div
              ref={userMenuRef}
              role="menu"
              aria-label={t.nav.userMenu}
              className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
            >
              <div className="px-3 py-2 border-b border-zinc-800 mb-1">
                <p className="text-sm font-semibold text-zinc-100 truncate">{session?.user?.name || t.nav.defaultUser}</p>
                <p className="text-xs text-zinc-500 truncate">{session?.user?.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Settings className="w-4 h-4" />
                {t.nav.settings}
              </button>
              <button
                role="menuitem"
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-xl transition-colors mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <LogOut className="w-4 h-4" />
                {t.nav.signOut}
              </button>
            </div>
          )}
        </div>
      </div>

      <RandomPickerModal
        isOpen={showRandomModal}
        onClose={() => setShowRandomModal(false)}
      />
    </header>
  );
};

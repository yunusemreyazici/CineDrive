import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Home, FolderGit2, Film, Tv, Heart, History, Settings, X } from 'lucide-react';
import { useUiStore } from '../../stores/useUiStore';

const navItems = [
  { to: '/', label: 'Ana Sayfa', icon: Home },
  { to: '/library', label: 'Kütüphane', icon: FolderGit2 },
  { to: '/movies', label: 'Filmler', icon: Film },
  { to: '/series', label: 'Diziler', icon: Tv },
  { to: '/favorites', label: 'Favoriler', icon: Heart },
  { to: '/history', label: 'Geçmiş', icon: History },
  { to: '/settings', label: 'Ayarlar', icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { sidebarOpen, sidebarCollapsed, setSidebarOpen } = useUiStore();

  return (
    <>
      {/* Mobile backdrop overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-zinc-950/80 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Navigation Drawer */}
      <aside
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
              onClick={() => setSidebarOpen(false)}
              aria-label="Menüyü kapat"
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white lg:hidden"
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

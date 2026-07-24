import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, FolderGit2, Film, Tv, Heart, History, HardDrive, Database, Settings, X, Activity } from 'lucide-react';
import { useUiStore } from '../../stores/useUiStore';

const navItems = [
  { to: '/', label: 'Ana Sayfa', icon: Home },
  { to: '/library', label: 'Kütüphane', icon: FolderGit2 },
  { to: '/movies', label: 'Filmler', icon: Film },
  { to: '/series', label: 'Diziler', icon: Tv },
  { to: '/favorites', label: 'Favoriler', icon: Heart },
  { to: '/history', label: 'Geçmiş', icon: History },
  { to: '/manage', label: 'Veri Yönetimi', icon: Database },
  { to: '/insights', label: 'Depolama Analizi', icon: HardDrive },
  { to: '/media-health', label: 'Medya Sağlığı', icon: Activity },
  { to: '/settings', label: 'Ayarlar', icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { sidebarOpen, setSidebarOpen } = useUiStore();

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
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-zinc-950/95 lg:bg-zinc-950/50 border-r border-zinc-800/50 p-4 flex flex-col justify-between transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          {/* Header in drawer view */}
          <div className="flex items-center justify-between lg:hidden mb-6 px-2">
            <span className="text-lg font-bold font-display text-white">Menü</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav Items */}
          <nav className="space-y-1.5 mt-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30 shadow-md shadow-brand-500/10'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/50 text-xs text-zinc-500">
          <p className="font-semibold text-zinc-300 mb-1 font-display">CineDrive v1.0</p>
          <p>Kişisel Google Drive Medya Sunucusu</p>
        </div>
      </aside>
    </>
  );
};

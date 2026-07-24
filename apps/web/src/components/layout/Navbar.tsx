import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Menu, Search, Film, User, LogOut, Settings } from 'lucide-react';
import { useUiStore } from '../../stores/useUiStore';
import { useSessionQuery, useLogoutMutation } from '../../hooks/useApi';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { toggleSidebar } = useUiStore();
  const { data: session } = useSessionQuery();
  const logoutMutation = useLogoutMutation();

  const [searchQuery, setSearchQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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
    <header className="sticky top-0 z-40 w-full h-16 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50 px-4 md:px-8 flex items-center justify-between gap-4">
      {/* Left section: Drawer toggle & Logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          aria-label="Menüyü Aç/Kapat"
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors focus:ring-2 focus:ring-brand-500 focus:outline-none"
        >
          <Menu className="w-6 h-6" />
        </button>

        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="p-2 bg-brand-600/20 border border-brand-500/30 rounded-xl text-brand-500 shadow-md shadow-brand-500/10 group-hover:scale-105 transition-transform">
            <Film className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold font-display tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            CineDrive
          </span>
        </Link>
      </div>

      {/* Middle section: Global Search Bar */}
      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md hidden sm:block">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Film, dizi veya başlık ara..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-zinc-900/60 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 transition-all"
          />
        </div>
      </form>

      {/* Right section: User profile & Menu */}
      <div className="relative">
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          aria-label="Kullanıcı Menüsü"
          className="flex items-center gap-2.5 p-1.5 rounded-full hover:bg-zinc-900 text-zinc-300 transition-colors focus:ring-2 focus:ring-brand-500 focus:outline-none"
        >
          <div className="w-9 h-9 rounded-full bg-brand-600/20 border border-brand-500/30 text-brand-400 flex items-center justify-center font-bold text-sm">
            {session?.user?.name ? session.user.name.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
          </div>
        </button>

        {userMenuOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-3 py-2 border-b border-zinc-800 mb-1">
              <p className="text-sm font-semibold text-zinc-100 truncate">{session?.user?.name || 'Kullanıcı'}</p>
              <p className="text-xs text-zinc-500 truncate">{session?.user?.email}</p>
            </div>
            <button
              onClick={() => {
                setUserMenuOpen(false);
                navigate('/settings');
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
            >
              <Settings className="w-4 h-4" />
              Ayarlar
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-xl transition-colors mt-1"
            >
              <LogOut className="w-4 h-4" />
              Çıkış Yap
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

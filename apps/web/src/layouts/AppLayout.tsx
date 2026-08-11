import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { useUiStore } from '../stores/useUiStore';
import { t } from '../i18n';
import { MusicPlayerProvider } from '../features/music/MusicPlayerProvider';
import { MusicPlayerBar } from '../features/music/MusicPlayerBar';
import { MusicSidebar } from '../components/music/MusicSidebar';

// Routes are code-split, so keep the shell mounted and swap only the content
// area while the next page chunk downloads.
const PageFallback: React.FC = () => (
  <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-zinc-500">
    <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
    <span className="font-display font-semibold">{t.common.loading}</span>
  </div>
);

export const AppLayout: React.FC = () => {
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const location = useLocation();
  const isMusicRoute = location.pathname === '/music' || location.pathname.startsWith('/music/');
  const appSidebarOffset = sidebarCollapsed ? 72 : 220;

  return (
    <MusicPlayerProvider>
      <div
        className="min-h-screen bg-[#070809] font-sans text-zinc-100 selection:bg-brand-500 selection:text-white"
        style={
          {
            '--app-sidebar-offset': `${appSidebarOffset}px`,
          } as React.CSSProperties
        }
      >
        <Sidebar />
        <div
          className={`min-w-0 transition-[margin] duration-300 ${
            sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[220px]'
          }`}
        >
          {isMusicRoute && <MusicSidebar />}
          <div
            className={
              isMusicRoute ? 'min-w-0 transition-[margin] duration-300 lg:ml-[272px]' : 'min-w-0'
            }
          >
            {!isMusicRoute && <Navbar />}
            <main
              className={`mx-auto w-full max-w-[1600px] py-4 pb-28 md:pb-28 ${
                isMusicRoute ? 'px-4 md:px-[18px] md:py-4' : 'px-4 md:px-6 md:py-5'
              }`}
            >
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            </main>
          </div>
        </div>
        <MusicPlayerBar />
      </div>
    </MusicPlayerProvider>
  );
};

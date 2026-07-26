import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { useUiStore } from '../stores/useUiStore';

// Routes are code-split, so keep the shell mounted and swap only the content
// area while the next page chunk downloads.
const PageFallback: React.FC = () => (
  <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-zinc-500">
    <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
    <span className="font-display font-semibold">Yükleniyor…</span>
  </div>
);

export const AppLayout: React.FC = () => {
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <div className="min-h-screen bg-[#070809] font-sans text-zinc-100 selection:bg-brand-500 selection:text-white">
      <Sidebar />
      <div
        className={`min-w-0 transition-[margin] duration-300 ${
          sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[220px]'
        }`}
      >
        <Navbar />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-4 md:px-6 md:py-5">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

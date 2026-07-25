import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';
import { useUiStore } from '../stores/useUiStore';

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
          <Outlet />
        </main>
      </div>
    </div>
  );
};

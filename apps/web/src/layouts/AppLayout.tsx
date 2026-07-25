import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '../components/layout/Navbar';
import { Sidebar } from '../components/layout/Sidebar';

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-brand-500 selection:text-white">
      <Navbar />

      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

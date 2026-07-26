import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, Home, ArrowLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-2xl border border-zinc-800/50 bg-zinc-900/30 p-12 text-center">
      <div className="mb-4 rounded-2xl border border-zinc-700/30 bg-zinc-800/40 p-4 text-zinc-400">
        <Compass className="h-10 w-10" />
      </div>
      <p className="font-display text-5xl font-extrabold tracking-tight text-brand-500">404</p>
      <h1 className="mt-3 font-display text-xl font-semibold text-zinc-100">Sayfa Bulunamadı</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">
        <span className="font-mono text-zinc-300">{location.pathname}</span> adresinde bir sayfa yok.
        Bağlantı eski olabilir veya adres yanlış yazılmış olabilir.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-brand-500/20 transition-all hover:bg-brand-500"
        >
          <Home className="h-4 w-4" />
          Ana Sayfa
        </Link>
        <Link
          to="/library"
          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-sm font-medium text-zinc-200 transition-all hover:bg-zinc-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Kütüphaneye Dön
        </Link>
      </div>
    </div>
  );
};

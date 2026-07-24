import React from 'react';
import { Film, Sparkles } from 'lucide-react';

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-brand-600/20 border border-brand-500/30 rounded-2xl text-brand-500 backdrop-blur-md shadow-lg shadow-brand-500/10">
          <Film className="w-10 h-10" />
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight font-display bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
          CineDrive
        </h1>
      </div>

      <p className="text-lg text-zinc-400 max-w-md mb-8 leading-relaxed">
        Google Drive tabanlı kişisel medya oynatıcı ve kütüphane yönetim platformu.
      </p>

      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm font-medium">
        <Sparkles className="w-4 h-4" />
        Aşama 1 & 2 Monorepo Altyapısı Hazır
      </div>
    </div>
  );
};

import React from 'react';

export const SkeletonCard: React.FC = () => {
  return (
    <div className="relative rounded-2xl bg-zinc-900/60 border border-zinc-800/60 overflow-hidden animate-pulse">
      <div className="w-full aspect-[2/3] bg-zinc-800/60" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-zinc-800/80 rounded-md w-3/4" />
        <div className="h-3 bg-zinc-800/50 rounded-md w-1/2" />
      </div>
    </div>
  );
};

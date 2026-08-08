import React from 'react';
import { Link } from 'react-router-dom';
import { Disc3, UserRound } from 'lucide-react';

interface Props { href: string; title: string; subtitle?: string | null; artworkUrl?: string | null; round?: boolean }

export const MusicCollectionCard: React.FC<Props> = ({ href, title, subtitle, artworkUrl, round }) => (
  <Link to={href} className="group min-w-0 rounded-xl border border-white/[0.06] bg-[#101113] p-3 transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-[#15171a]">
    <div className={`mb-3 aspect-square overflow-hidden bg-zinc-900 ${round ? 'rounded-full' : 'rounded-lg'}`}>
      {artworkUrl ? <img src={artworkUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <span className="flex h-full items-center justify-center text-zinc-700">{round ? <UserRound className="h-1/3 w-1/3" /> : <Disc3 className="h-1/3 w-1/3" />}</span>}
    </div>
    <p className="truncate text-sm font-semibold text-white">{title}</p>
    {subtitle && <p className="mt-1 truncate text-xs text-zinc-500">{subtitle}</p>}
  </Link>
);

import React from 'react';
import { Disc3, Play, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  href: string;
  title: string;
  subtitle?: string | null;
  artworkUrl?: string | null;
  round?: boolean;
}

export const MusicCollectionCard: React.FC<Props> = ({
  href,
  title,
  subtitle,
  artworkUrl,
  round,
}) => (
  <Link
    to={href}
    className="group block min-w-0 rounded-2xl p-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
  >
    <div
      className={`relative mb-3 aspect-square overflow-hidden border border-white/[0.07] bg-gradient-to-br from-zinc-800 to-zinc-950 shadow-[0_18px_45px_rgba(0,0,0,.28)] ${
        round ? 'rounded-full' : 'rounded-2xl'
      }`}
    >
      {artworkUrl ? (
        <img
          src={artworkUrl}
          alt=""
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <span className="flex h-full items-center justify-center text-zinc-700">
          {round ? <UserRound className="h-1/3 w-1/3" /> : <Disc3 className="h-1/3 w-1/3" />}
        </span>
      )}
      <span
        className={`absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/55 via-transparent to-transparent p-3 opacity-0 transition duration-300 group-hover:opacity-100 ${round ? 'rounded-full' : 'rounded-2xl'}`}
      >
        <span className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-white text-black shadow-xl transition duration-300 group-hover:translate-y-0">
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </span>
      </span>
    </div>
    <p className="truncate text-sm font-semibold tracking-tight text-white transition group-hover:text-brand-300">
      {title}
    </p>
    {subtitle && <p className="mt-1 truncate text-xs text-white/40">{subtitle}</p>}
  </Link>
);

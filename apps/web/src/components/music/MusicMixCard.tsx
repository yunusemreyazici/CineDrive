import React from 'react';
import type { MusicMixDto } from '@cinedrive/shared';
import { Play, Radio, Sparkles } from 'lucide-react';
import { t } from '../../i18n';

const gradients: Record<string, string> = {
  violet: 'from-violet-950 via-violet-700 to-fuchsia-400',
  cyan: 'from-cyan-950 via-sky-700 to-cyan-300',
  amber: 'from-amber-950 via-orange-600 to-yellow-300',
  rose: 'from-rose-950 via-rose-700 to-pink-300',
  emerald: 'from-emerald-950 via-emerald-700 to-teal-300',
  indigo: 'from-indigo-950 via-indigo-700 to-blue-300',
};

export const MusicMixCard: React.FC<{
  mix: MusicMixDto;
  onPlay: () => void;
  compact?: boolean;
}> = ({ mix, onPlay, compact }) => {
  const moodId = mix.id.replace('mood-', '') as keyof typeof t.music.moods;
  const title =
    mix.type === 'daily'
      ? t.music.dailyDiscovery
      : mix.type === 'mood' && t.music.moods[moodId]
        ? t.music.moods[moodId]
        : mix.title;
  const subtitle =
    mix.type === 'daily'
      ? t.music.dailyDiscoveryHint
      : mix.type === 'recent'
        ? t.music.recentMixHint
        : mix.type === 'mood'
          ? t.music.moodCollectionHint
          : mix.subtitle;
  return (
    <article className="group min-w-0">
      <div
        className={`relative aspect-square overflow-hidden rounded-[24px] bg-gradient-to-br ${gradients[mix.accent] || gradients.violet} shadow-xl shadow-black/25`}
      >
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 opacity-75 mix-blend-luminosity transition duration-700 group-hover:scale-105 group-hover:opacity-90">
          {mix.artworkUrls.slice(0, 4).map((url, index) => (
            <img key={`${url}-${index}`} src={url} alt="" className="h-full w-full object-cover" />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
        <div className="absolute left-5 top-5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-white/75">
          {mix.type === 'artist-radio' ? (
            <Radio className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          CineDrive Mix
        </div>
        <div className="absolute inset-x-5 bottom-5">
          <p
            className={`${compact ? 'text-xl' : 'text-2xl md:text-3xl'} font-display font-extrabold leading-none tracking-tight text-white`}
          >
            {title}
          </p>
          <p className="mt-2 line-clamp-1 text-xs font-medium text-white/60">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onPlay}
          aria-label={t.music.playMix(title)}
          className="absolute bottom-5 right-5 translate-y-3 rounded-full bg-white p-3 text-black opacity-0 shadow-2xl transition group-hover:translate-y-0 group-hover:opacity-100 focus:translate-y-0 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Play className="h-5 w-5 fill-current" />
        </button>
      </div>
      <p className="mt-3 truncate text-sm font-bold">{title}</p>
      <p className="mt-1 truncate text-xs text-white/40">{t.music.trackCount(mix.tracks.length)}</p>
    </article>
  );
};

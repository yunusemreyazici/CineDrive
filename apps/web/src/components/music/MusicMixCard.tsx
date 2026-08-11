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
  landscape?: boolean;
}> = ({ mix, onPlay, compact, landscape }) => {
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
        className={`relative overflow-hidden bg-gradient-to-br ${gradients[mix.accent] || gradients.violet} shadow-xl shadow-black/25 ${
          landscape
            ? compact
              ? 'aspect-[2.35/1] rounded-[18px]'
              : 'aspect-[1.8/1] rounded-[20px]'
            : 'aspect-square rounded-[24px]'
        }`}
      >
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 opacity-75 mix-blend-luminosity transition duration-700 group-hover:scale-105 group-hover:opacity-90">
          {mix.artworkUrls.slice(0, 4).map((url, index) => (
            <img key={`${url}-${index}`} src={url} alt="" className="h-full w-full object-cover" />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
        <div
          className={`absolute flex items-center gap-2 font-extrabold uppercase tracking-[0.22em] text-white/75 ${
            landscape ? 'left-4 top-4 text-[8px]' : 'left-5 top-5 text-[10px]'
          } ${compact ? 'hidden' : ''}`}
        >
          {mix.type === 'artist-radio' ? (
            <Radio className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          CineDrive Mix
        </div>
        <div
          className={`absolute ${landscape ? 'inset-x-4 bottom-4 pr-9' : 'inset-x-5 bottom-5'}`}
        >
          <p
            className={`font-display font-extrabold leading-none tracking-tight text-white ${
              landscape
                ? compact
                  ? 'text-base'
                  : 'text-lg'
                : compact
                  ? 'text-xl'
                  : 'text-2xl md:text-3xl'
            }`}
          >
            {title}
          </p>
          {!compact && (
            <p
              className={`${landscape ? 'mt-1.5 text-[10px]' : 'mt-2 text-xs'} line-clamp-1 font-medium text-white/60`}
            >
              {subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onPlay}
          aria-label={t.music.playMix(title)}
          className={`absolute rounded-full bg-white text-black shadow-2xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
            landscape
              ? 'bottom-3.5 right-3.5 p-2 opacity-90 hover:scale-105 hover:opacity-100'
              : 'bottom-5 right-5 translate-y-3 p-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus:translate-y-0 focus:opacity-100'
          }`}
        >
          <Play className={`${landscape ? 'h-4 w-4' : 'h-5 w-5'} fill-current`} />
        </button>
      </div>
      {!landscape && (
        <>
          <p className="mt-3 truncate text-sm font-bold">{title}</p>
          <p className="mt-1 truncate text-xs text-white/40">
            {t.music.trackCount(mix.tracks.length)}
          </p>
        </>
      )}
    </article>
  );
};

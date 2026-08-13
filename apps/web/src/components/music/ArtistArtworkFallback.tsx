import React from 'react';

interface Props {
  name: string;
  compact?: boolean;
  className?: string;
}

const hashName = (name: string) =>
  Array.from(name).reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 0);

const initialsFor = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '♪';
  const initials =
    words.length === 1 ? words[0]![0]! : `${words[0]![0]!}${words.at(-1)![0]!}`;
  return initials.toLocaleUpperCase('tr-TR');
};

export const ArtistArtworkFallback: React.FC<Props> = ({ name, compact, className = '' }) => {
  const hash = hashName(name);
  const hue = hash % 360;
  const accentHue = (hue + 48 + (hash % 72)) % 360;

  return (
    <div
      aria-hidden="true"
      className={`relative isolate flex h-full w-full items-center justify-center overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 46% 24%), hsl(${accentHue} 54% 10%) 72%)`,
      }}
    >
      <span
        className="absolute -right-[12%] -top-[18%] h-[72%] w-[72%] rounded-full border border-white/10 bg-white/[.06] blur-[1px]"
        style={{ transform: `rotate(${hash % 45}deg)` }}
      />
      <span className="absolute -bottom-[25%] -left-[18%] h-[75%] w-[75%] rounded-full border-[10px] border-white/[.045]" />
      <span className="absolute inset-[14%] rounded-full border border-white/[.08]" />
      <span
        className={`relative font-display font-black tracking-[-0.08em] text-white/80 drop-shadow-[0_8px_18px_rgba(0,0,0,.35)] ${compact ? 'text-sm' : 'text-4xl sm:text-5xl'}`}
      >
        {initialsFor(name)}
      </span>
    </div>
  );
};

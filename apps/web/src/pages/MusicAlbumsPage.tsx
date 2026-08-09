import React, { useMemo, useState } from 'react';
import { CalendarDays, Grid3X3, Rows3 } from 'lucide-react';
import type { MusicAlbumDto } from '@cinedrive/shared';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { useMusicAlbumsQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

type AlbumView = 'wall' | 'shelf' | 'year';
const viewStorageKey = 'cinedrive.music.album-view';
const readStoredView = (): AlbumView => {
  try {
    const saved = window.localStorage.getItem(viewStorageKey);
    return saved === 'shelf' || saved === 'year' ? saved : 'wall';
  } catch {
    return 'wall';
  }
};

const AlbumCover: React.FC<{ album: MusicAlbumDto; compact?: boolean }> = ({ album, compact }) => (
  <MusicCollectionCard
    href={`/music/albums/${album.id}`}
    title={album.title}
    subtitle={[album.artist?.name, album.year].filter(Boolean).join(' · ')}
    artworkUrl={album.artworkUrl}
    compact={compact}
  />
);

export const MusicAlbumsPage: React.FC = () => {
  const query = useMusicAlbumsQuery({ limit: 200, sortBy: 'year', sortOrder: 'desc' });
  const [view, setViewState] = useState<AlbumView>(readStoredView);
  const albums = useMemo(() => query.data || [], [query.data]);
  const byYear = useMemo(() => {
    const groups = new Map<string, MusicAlbumDto[]>();
    albums.forEach((album) => {
      const key = album.year ? String(album.year) : t.music.unknownYear;
      groups.set(key, [...(groups.get(key) || []), album]);
    });
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === t.music.unknownYear) return 1;
      if (b === t.music.unknownYear) return -1;
      return Number(b) - Number(a);
    });
  }, [albums]);
  const setView = (next: AlbumView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(viewStorageKey, next);
    } catch {
      // The visual mode still changes when storage is unavailable.
    }
  };
  const views: Array<{ id: AlbumView; label: string; icon: React.ElementType }> = [
    { id: 'wall', label: t.music.albumWall, icon: Grid3X3 },
    { id: 'shelf', label: t.music.albumShelf, icon: Rows3 },
    { id: 'year', label: t.music.browseByYear, icon: CalendarDays },
  ];

  return (
    <div className="space-y-7 pb-28">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-300">CineDrive Music</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold md:text-5xl">{t.music.albums}</h1>
          <p className="mt-2 text-sm text-white/40">{t.music.albumLibraryCount(albums.length)}</p>
        </div>
        <div className="inline-flex rounded-2xl border border-white/[0.08] bg-black/25 p-1" role="group" aria-label={t.music.albumView}>
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              title={label}
              onClick={() => setView(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${view === id ? 'bg-white text-black shadow-lg' : 'text-white/45 hover:bg-white/[0.06] hover:text-white'}`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </header>

      {query.isLoading && <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 14 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-2xl bg-white/[0.05]" />)}</div>}

      {!query.isLoading && view === 'wall' && (
        <section aria-label={t.music.albumWall} className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-5 2xl:grid-cols-8">
          {albums.map((album) => <AlbumCover key={album.id} album={album} compact />)}
        </section>
      )}

      {!query.isLoading && view === 'shelf' && (
        <section aria-label={t.music.albumShelf} className="space-y-9 overflow-hidden rounded-[30px] border border-white/[0.07] bg-gradient-to-b from-zinc-950 to-black px-4 py-8 md:px-8">
          {Array.from({ length: Math.ceil(albums.length / 6) }, (_, shelf) => albums.slice(shelf * 6, shelf * 6 + 6)).map((row, index) => (
            <div key={row[0]?.id || index} className="relative grid grid-cols-3 items-end gap-3 px-2 pb-5 sm:grid-cols-4 lg:grid-cols-6">
              {row.map((album) => (
                <div key={album.id} className="relative z-10 origin-bottom transition duration-300 hover:-translate-y-2 hover:scale-[1.02]">
                  <AlbumCover album={album} compact />
                </div>
              ))}
              <div aria-hidden="true" className="absolute inset-x-0 bottom-2 h-4 rounded-sm border-t border-white/20 bg-gradient-to-b from-zinc-600/70 via-zinc-900 to-black shadow-[0_16px_25px_rgba(0,0,0,.9)]" />
            </div>
          ))}
        </section>
      )}

      {!query.isLoading && view === 'year' && (
        <div className="space-y-12">
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label={t.music.browseByYear}>
            {byYear.map(([year]) => <a key={year} href={`#album-year-${year}`} className="shrink-0 rounded-full border border-white/10 px-4 py-2 text-xs font-black text-white/55 transition hover:bg-white hover:text-black">{year}</a>)}
          </nav>
          {byYear.map(([year, yearAlbums]) => (
            <section key={year} id={`album-year-${year}`} className="scroll-mt-24">
              <div className="mb-5 flex items-baseline gap-4 border-b border-white/[0.07] pb-3">
                <h2 className="font-display text-4xl font-black text-white">{year}</h2>
                <span className="text-xs font-bold text-white/35">{t.music.albumCount(yearAlbums.length)}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-7">
                {yearAlbums.map((album) => <AlbumCover key={album.id} album={album} compact />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {!query.isLoading && !albums.length && <div className="rounded-3xl border border-dashed border-white/10 p-16 text-center text-sm text-white/35">{t.music.noAlbums}</div>}
    </div>
  );
};

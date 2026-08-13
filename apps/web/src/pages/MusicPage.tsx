import React from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Disc3,
  LibraryBig,
  ListEnd,
  MoreHorizontal,
  Play,
  Shuffle,
  StepForward,
} from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import { useMusicDiscoveryQuery, useMusicOverviewQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

const SectionHeading: React.FC<{
  title: string;
  eyebrow?: string;
  href?: string;
}> = ({ title, eyebrow, href }) => (
  <div className="flex items-end justify-between gap-4">
    <div>
      {eyebrow && (
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-400/80">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-xl font-bold leading-none tracking-[-0.02em] text-white">
        {title}
      </h2>
    </div>
    {href && (
      <Link
        to={href}
        className="group flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-400 transition hover:text-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        {t.common.seeAll}
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </Link>
    )}
  </div>
);

interface ArrivalAlbumItem {
  id: string;
  title: string;
  subtitle?: string | null;
  artworkUrl?: string | null;
  href: string;
}

const ArrivalTile: React.FC<{
  item: ArrivalAlbumItem;
}> = ({ item }) => (
  <Link
    to={item.href}
    aria-label={t.music.openAlbum(item.title)}
    className="group block min-w-0 flex-[1_0_112px] rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 xl:min-w-0 xl:basis-[calc((100%-5.25rem)/8)]"
  >
    <span className="relative block aspect-square overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#121417] shadow-[0_12px_28px_rgba(0,0,0,.2)]">
      {item.artworkUrl ? (
        <img
          src={item.artworkUrl}
          alt=""
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
        />
      ) : (
        <span className="flex h-full items-center justify-center text-zinc-700">
          <Disc3 className="h-10 w-10" />
        </span>
      )}
      <span className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-xl">
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </span>
    </span>
    <span className="mt-2.5 block truncate text-sm font-semibold text-white">{item.title}</span>
    {item.subtitle && (
      <span className="mt-1 block truncate text-[11px] text-zinc-500">{item.subtitle}</span>
    )}
  </Link>
);

export const MusicPage: React.FC = () => {
  const query = useMusicOverviewQuery();
  const discoveryQuery = useMusicDiscoveryQuery();
  const player = useMusicPlayer();
  const location = useLocation();
  const arrivalsRailRef = React.useRef<HTMLDivElement>(null);

  if (location.hash === '#music-mixes') return <Navigate to="/music/mixes" replace />;

  if (query.isLoading) {
    return (
      <div className="space-y-8 pb-32">
        <div className="h-14 w-56 animate-pulse rounded-xl bg-zinc-900" />
        <div className="h-[300px] animate-pulse rounded-[24px] bg-zinc-900" />
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="aspect-square animate-pulse rounded-[18px] bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        title={t.music.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const data = query.data;
  const discovery = discoveryQuery.data;
  if (!data || (!data.recentTracks.length && !data.recentAlbums.length)) {
    return (
      <EmptyState
        icon={LibraryBig}
        title={t.music.emptyTitle}
        description={t.music.emptyDescription}
      />
    );
  }

  const spotlightTrack =
    discovery?.continueListening?.track || data.recentHistory[0]?.track || data.recentTracks[0];
  const spotlightQueue = spotlightTrack
    ? [spotlightTrack, ...data.recentTracks.filter((track) => track.id !== spotlightTrack.id)]
    : data.recentTracks;
  const resume = discovery?.continueListening;
  const resumePosition =
    resume && resume.track.id === spotlightTrack?.id ? resume.positionSeconds : null;
  const recentlyPlayedTracks = data.recentHistory
    .map((entry) => entry.track)
    .filter((track, index, tracks) => tracks.findIndex((item) => item.id === track.id) === index);
  const listeningTracks = recentlyPlayedTracks.length
    ? recentlyPlayedTracks.slice(0, 6)
    : data.recentTracks.slice(0, 6);
  const arrivals: ArrivalAlbumItem[] = data.recentAlbums.slice(0, 8).map((album) => ({
    id: `album-${album.id}`,
    title: album.title,
    subtitle: album.artist?.name || t.music.album,
    artworkUrl: album.artworkUrl,
    href: `/music/albums/${album.id}`,
  }));

  const playSpotlight = () => {
    player.playTracks(spotlightQueue);
    if (resumePosition !== null) {
      window.setTimeout(() => player.seek(resumePosition), 350);
    }
  };

  return (
    <div className="pb-32">
      <header className="relative -top-1 hidden pt-1 sm:block">
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.035em] text-white">
          {t.music.title}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">{t.music.homeSubtitle}</p>
      </header>

      <section
        aria-labelledby="music-spotlight-title"
        className="relative mt-4 overflow-hidden rounded-[12px] border border-white/[0.09] bg-[#0c0e10] p-4 shadow-[0_20px_55px_rgba(0,0,0,.22)]"
      >
        {spotlightTrack?.artworkUrl && (
          <img
            src={spotlightTrack.artworkUrl}
            alt=""
            className="pointer-events-none absolute -right-20 -top-40 h-[520px] w-[520px] scale-125 object-cover opacity-[0.08] blur-3xl"
          />
        )}
        <div className="relative grid items-center gap-6 md:grid-cols-[250px_minmax(0,1fr)] md:gap-8">
          {spotlightTrack?.album ? (
            <Link
              to={`/music/albums/${spotlightTrack.album.id}`}
              aria-label={t.music.openAlbum(spotlightTrack.album.title)}
              className="group aspect-square overflow-hidden rounded-[10px] border border-white/[0.1] bg-[#131519] shadow-[0_18px_45px_rgba(0,0,0,.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 md:h-[218px] md:aspect-auto"
            >
              {spotlightTrack.artworkUrl ? (
                <img
                  src={spotlightTrack.artworkUrl}
                  alt=""
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-zinc-700">
                  <Disc3 className="h-20 w-20" />
                </span>
              )}
            </Link>
          ) : (
            <button
              type="button"
              onClick={playSpotlight}
              aria-label={spotlightTrack ? t.music.playTrack(spotlightTrack.title) : t.music.play}
              className="group aspect-square overflow-hidden rounded-[10px] border border-white/[0.1] bg-[#131519] shadow-[0_18px_45px_rgba(0,0,0,.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 md:h-[218px] md:aspect-auto"
            >
              {spotlightTrack?.artworkUrl ? (
                <img
                  src={spotlightTrack.artworkUrl}
                  alt=""
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-zinc-700">
                  <Disc3 className="h-20 w-20" />
                </span>
              )}
            </button>
          )}

          <div className="min-w-0 py-1 md:translate-y-[15px] md:pr-4 lg:pr-8">
            <button
              type="button"
              onClick={playSpotlight}
              id="music-spotlight-title"
              className="block max-w-full text-left font-display text-3xl font-extrabold leading-[1.02] tracking-[-0.035em] text-white transition hover:text-brand-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:text-[32px]"
            >
              {spotlightTrack?.title || t.music.title}
            </button>
            {spotlightTrack?.primaryArtist ? (
              <Link
                to={`/music/artists/${spotlightTrack.primaryArtist.id}`}
                className="mt-3 inline-block text-base font-medium text-zinc-300 transition hover:text-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {spotlightTrack.primaryArtist.name}
              </Link>
            ) : (
              <p className="mt-3 text-base font-medium text-zinc-300">{t.music.subtitle}</p>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
              {spotlightTrack?.album?.title && (
                <Link
                  to={`/music/albums/${spotlightTrack.album.id}`}
                  className="transition hover:text-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {spotlightTrack.album.title}
                </Link>
              )}
              {spotlightTrack?.year && <span>· {spotlightTrack.year}</span>}
              <span>· {t.music.trackCount(spotlightQueue.length)}</span>
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={playSpotlight}
                disabled={!spotlightQueue.length}
                className="inline-flex h-[42px] items-center gap-2.5 rounded-full bg-white px-6 text-sm font-bold text-black shadow-xl transition hover:scale-[1.015] hover:bg-zinc-100 active:scale-[0.985] disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current" />
                {resumePosition !== null ? t.music.continueTrack : t.music.play}
              </button>
              <button
                type="button"
                onClick={() => player.playShuffledTracks(spotlightQueue)}
                disabled={!spotlightQueue.length}
                className="inline-flex h-[42px] items-center gap-2.5 rounded-full border border-white/[0.14] bg-white/[0.025] px-5 text-sm font-semibold text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" />
                {t.music.shufflePlay}
              </button>
              {spotlightTrack && (
                <details className="relative">
                  <summary
                    aria-label={t.music.moreActions}
                    className="flex h-[42px] w-[42px] list-none cursor-pointer items-center justify-center rounded-full border border-white/[0.14] text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.06]"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </summary>
                  <div className="absolute left-0 z-30 mt-2 w-48 rounded-xl border border-white/10 bg-zinc-950 p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => player.playNext(spotlightTrack)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5"
                    >
                      <StepForward className="h-4 w-4" />
                      {t.music.playNext}
                    </button>
                    <button
                      type="button"
                      onClick={() => player.addToQueue(spotlightTrack)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5"
                    >
                      <ListEnd className="h-4 w-4" />
                      {t.music.addQueue}
                    </button>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      </section>

      {!!arrivals.length && (
        <section className="mt-4 space-y-3">
          <SectionHeading title={t.music.newArrivals} href="/music/albums" />
          <div className="relative">
            <div
              ref={arrivalsRailRef}
              className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {arrivals.map((item) => (
                <ArrivalTile key={item.id} item={item} />
              ))}
            </div>
            {arrivals.length > 6 && (
              <button
                type="button"
                onClick={() => arrivalsRailRef.current?.scrollBy({ left: 420, behavior: 'smooth' })}
                aria-label={t.music.next}
                className="absolute right-0 top-[42px] hidden h-10 w-10 translate-x-1/3 items-center justify-center rounded-full border border-white/10 bg-[#101214]/95 text-zinc-300 shadow-xl transition hover:bg-[#17191c] xl:flex"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </section>
      )}

      {!!listeningTracks.length && (
        <section className="mt-4 space-y-3">
          <SectionHeading title={t.music.recentlyPlayed} href="/music/history" />
          <MusicTrackList tracks={listeningTracks} homeLayout />
        </section>
      )}
    </div>
  );
};

import React from 'react';
import type { MusicTrackDto } from '@cinedrive/shared';
import { ArrowRight, Disc3, LibraryBig, Play, Shuffle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { MusicMixCard } from '../components/music/MusicMixCard';
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
      <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-white md:text-2xl">
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

interface ArrivalItem {
  id: string;
  title: string;
  subtitle?: string | null;
  artworkUrl?: string | null;
  href?: string;
  track?: MusicTrackDto;
}

const ArrivalTile: React.FC<{
  item: ArrivalItem;
  onPlay: (track: MusicTrackDto) => void;
}> = ({ item, onPlay }) => {
  const content = (
    <>
      <span className="relative block aspect-square overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#121417] shadow-[0_16px_35px_rgba(0,0,0,.24)]">
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
        {item.track && (
          <span className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-xl">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
          </span>
        )}
      </span>
      <span className="mt-2.5 block truncate text-sm font-semibold text-white">{item.title}</span>
      {item.subtitle && (
        <span className="mt-1 block truncate text-[11px] text-zinc-500">{item.subtitle}</span>
      )}
    </>
  );

  return item.href ? (
    <Link
      to={item.href}
      className="group block min-w-0 rounded-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => item.track && onPlay(item.track)}
      aria-label={item.track ? t.music.playTrack(item.title) : item.title}
      className="group block min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {content}
    </button>
  );
};

export const MusicPage: React.FC = () => {
  const query = useMusicOverviewQuery();
  const discoveryQuery = useMusicDiscoveryQuery();
  const player = useMusicPlayer();

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
  const arrivals: ArrivalItem[] = [
    ...data.recentAlbums.slice(0, 4).map((album) => ({
      id: `album-${album.id}`,
      title: album.title,
      subtitle: album.artist?.name || t.music.album,
      artworkUrl: album.artworkUrl,
      href: `/music/albums/${album.id}`,
    })),
    ...data.recentTracks.slice(0, 4).map((track) => ({
      id: `track-${track.id}`,
      title: track.title,
      subtitle: track.primaryArtist?.name || t.music.artist,
      artworkUrl: track.artworkUrl,
      track,
    })),
  ];

  const playSpotlight = () => {
    player.playTracks(spotlightQueue);
    if (resumePosition !== null) {
      window.setTimeout(() => player.seek(resumePosition), 350);
    }
  };

  return (
    <div className="space-y-12 pb-32 md:space-y-16">
      <header className="pt-1">
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.035em] text-white md:text-4xl">
          {t.music.title}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500">{t.music.homeSubtitle}</p>
      </header>

      <section
        aria-labelledby="music-spotlight-title"
        className="relative overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#0c0e10] p-4 shadow-[0_24px_70px_rgba(0,0,0,.26)] sm:p-5 md:p-6"
      >
        {spotlightTrack?.artworkUrl && (
          <img
            src={spotlightTrack.artworkUrl}
            alt=""
            className="pointer-events-none absolute -right-20 -top-40 h-[520px] w-[520px] scale-125 object-cover opacity-[0.08] blur-3xl"
          />
        )}
        <div className="relative grid items-center gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-9">
          <div className="aspect-square overflow-hidden rounded-[20px] border border-white/[0.1] bg-[#131519] shadow-[0_22px_55px_rgba(0,0,0,.4)]">
            {spotlightTrack?.artworkUrl ? (
              <img src={spotlightTrack.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-700">
                <Disc3 className="h-20 w-20" />
              </div>
            )}
          </div>

          <div className="min-w-0 py-2 md:pr-4 lg:pr-8">
            <h2
              id="music-spotlight-title"
              className="font-display text-3xl font-extrabold leading-[1.02] tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl"
            >
              {spotlightTrack?.title || t.music.title}
            </h2>
            <p className="mt-3 text-base font-medium text-zinc-300">
              {spotlightTrack?.primaryArtist?.name || t.music.subtitle}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
              {spotlightTrack?.album?.title && <span>{spotlightTrack.album.title}</span>}
              {spotlightTrack?.year && <span>· {spotlightTrack.year}</span>}
              <span>· {t.music.trackCount(spotlightQueue.length)}</span>
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={playSpotlight}
                disabled={!spotlightQueue.length}
                className="inline-flex items-center gap-2.5 rounded-full bg-white px-6 py-3 text-sm font-bold text-black shadow-xl transition hover:scale-[1.015] hover:bg-zinc-100 active:scale-[0.985] disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current" />
                {resumePosition !== null ? t.music.continueTrack : t.music.play}
              </button>
              <button
                type="button"
                onClick={() => player.playShuffledTracks(spotlightQueue)}
                disabled={!spotlightQueue.length}
                className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.14] bg-white/[0.025] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" />
                {t.music.shufflePlay}
              </button>
            </div>
          </div>
        </div>
      </section>

      {!!arrivals.length && (
        <section className="space-y-5">
          <SectionHeading title={t.music.newArrivals} href="/music/albums" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {arrivals.slice(0, 6).map((item) => (
              <ArrivalTile
                key={item.id}
                item={item}
                onPlay={(track) => player.playTracks([track])}
              />
            ))}
          </div>
        </section>
      )}

      {!!discovery?.mixes.length && (
        <section id="music-mixes" className="scroll-mt-24 space-y-5">
          <SectionHeading
            title={t.music.smartMixes}
            eyebrow={t.music.madeForYou}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {discovery.mixes.slice(0, 4).map((item) => (
              <MusicMixCard
                key={item.id}
                mix={item}
                onPlay={() => player.playTracks(item.tracks)}
                landscape
              />
            ))}
          </div>
        </section>
      )}

      {!!discovery?.moodCollections.length && (
        <section className="space-y-5">
          <SectionHeading title={t.music.moodsAndGenres} eyebrow={t.music.chooseYourMood} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {discovery.moodCollections.map((item) => (
              <MusicMixCard
                key={item.id}
                mix={item}
                compact
                landscape
                onPlay={() => player.playTracks(item.tracks)}
              />
            ))}
          </div>
        </section>
      )}

      {!!listeningTracks.length && (
        <section className="space-y-5">
          <SectionHeading title={t.music.recentlyPlayed} href="/music/history" />
          <div className="border-t border-white/[0.08] pt-2">
            <MusicTrackList tracks={listeningTracks} />
          </div>
        </section>
      )}
    </div>
  );
};

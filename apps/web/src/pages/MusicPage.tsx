import React, { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Disc3,
  Heart,
  History,
  LibraryBig,
  ListMusic,
  Play,
  Plus,
  Radio,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { MusicMixCard } from '../components/music/MusicMixCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import {
  useCreateMusicPlaylistMutation,
  useMusicDiscoveryQuery,
  useMusicOverviewQuery,
} from '../hooks/useMusicApi';
import { t } from '../i18n';

const Section: React.FC<
  React.PropsWithChildren<{ title: string; eyebrow?: string; href?: string }>
> = ({ title, eyebrow, href, children }) => (
  <section className="space-y-4">
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-400/80">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
      </div>
      {href && (
        <Link
          to={href}
          className="group flex shrink-0 items-center gap-1.5 text-xs font-semibold text-white/40 transition hover:text-white"
        >
          {t.common.seeAll}
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
    {children}
  </section>
);

interface QuickCardProps {
  href: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string | null;
  icon: LucideIcon;
  tone: string;
}

const QuickCard: React.FC<QuickCardProps> = ({
  href,
  title,
  subtitle,
  artworkUrl,
  icon: Icon,
  tone,
}) => (
  <Link
    to={href}
    className="group relative flex min-h-24 items-center gap-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.045] p-3.5 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.075] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
  >
    <div
      className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ${tone}`}
    >
      {artworkUrl ? (
        <img
          src={artworkUrl}
          alt=""
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <Icon className="h-7 w-7 text-white/90" />
      )}
    </div>
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-white">{title}</p>
      {subtitle && <p className="mt-1 truncate text-xs text-white/40">{subtitle}</p>}
    </div>
    <Play className="ml-auto h-4 w-4 shrink-0 fill-current text-white/0 transition group-hover:text-white/70" />
  </Link>
);

export const MusicPage: React.FC = () => {
  const query = useMusicOverviewQuery();
  const discoveryQuery = useMusicDiscoveryQuery();
  const player = useMusicPlayer();
  const createPlaylist = useCreateMusicPlaylistMutation();
  const [newName, setNewName] = useState('');
  if (query.isLoading)
    return (
      <div className="space-y-8 pb-32">
        <div className="h-[420px] animate-pulse rounded-[32px] bg-zinc-900" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="h-24 animate-pulse rounded-2xl bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title={t.music.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  const data = query.data;
  const discovery = discoveryQuery.data;
  if (!data || (!data.recentTracks.length && !data.recentAlbums.length))
    return (
      <EmptyState
        icon={LibraryBig}
        title={t.music.emptyTitle}
        description={t.music.emptyDescription}
      />
    );

  const heroTrack =
    discovery?.continueListening?.track || data.recentHistory[0]?.track || data.recentTracks[0];
  const heroQueue = heroTrack
    ? [heroTrack, ...data.recentTracks.filter((track) => track.id !== heroTrack.id)]
    : data.recentTracks;
  const resume = discovery?.continueListening;
  const resumePosition = resume && resume.track.id === heroTrack?.id ? resume.positionSeconds : null;
  const firstAlbum = data.recentAlbums[0];
  const firstArtist = data.artists[0];
  const recentlyPlayedTracks = data.recentHistory
    .map((entry) => entry.track)
    .filter((track, index, tracks) => tracks.findIndex((item) => item.id === track.id) === index);

  return (
    <div className="space-y-11 pb-32 md:space-y-14">
      <h1 className="sr-only">{t.music.title}</h1>
      <header className="relative isolate min-h-[390px] overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#101114] shadow-[0_32px_90px_rgba(0,0,0,.35)] md:min-h-[440px] md:rounded-[36px]">
        {heroTrack?.artworkUrl && (
          <img
            src={heroTrack.artworkUrl}
            alt=""
            className="absolute inset-0 -z-30 h-full w-full scale-105 object-cover opacity-70 blur-[2px]"
          />
        )}
        <div className="absolute inset-0 -z-20 bg-gradient-to-r from-black via-black/80 to-black/10" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-transparent to-black/15" />
        <div className="flex min-h-[390px] max-w-3xl flex-col justify-end p-6 md:min-h-[440px] md:p-10 lg:p-12">
          <div className="mb-auto flex items-center gap-2 pt-1 text-[10px] font-bold uppercase tracking-[0.25em] text-white/55">
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            CineDrive Music
          </div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">
            {data.recentHistory.length ? t.music.continueListening : t.music.justAdded}
          </p>
          <h1 className="max-w-2xl font-display text-4xl font-extrabold leading-[0.95] tracking-[-0.035em] sm:text-5xl md:text-7xl">
            {heroTrack?.title || t.music.title}
          </h1>
          <p className="mt-4 text-sm font-medium text-white/55 md:text-base">
            {heroTrack?.primaryArtist?.name || t.music.subtitle}
            {heroTrack?.album?.title ? ` · ${heroTrack.album.title}` : ''}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                player.playTracks(heroQueue);
                if (resumePosition !== null) {
                  window.setTimeout(() => player.seek(resumePosition), 350);
                }
              }}
              disabled={!heroQueue.length}
              className="inline-flex items-center gap-2.5 rounded-full bg-white px-6 py-3 text-sm font-bold text-black shadow-xl transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              {resumePosition !== null ? t.music.continueTrack : t.music.play}
            </button>
            <Link
              to="/music/tracks"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/25 px-5 py-3 text-sm font-semibold text-white backdrop-blur-xl transition hover:bg-white/10"
            >
              <Radio className="h-4 w-4" />
              {t.music.openLibrary}
            </Link>
          </div>
        </div>
      </header>

      {!!discovery?.mixes.length && (
        <Section title={t.music.smartMixes} eyebrow={t.music.madeForYou}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
            {discovery.mixes.slice(0, 4).map((item) => (
              <MusicMixCard
                key={item.id}
                mix={item}
                onPlay={() => player.playTracks(item.tracks)}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title={t.music.quickAccess} eyebrow={t.music.forYou}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <QuickCard
            href="/music/liked"
            title={t.music.liked}
            subtitle={t.music.trackCount(data.favoriteCount)}
            icon={Heart}
            tone="from-fuchsia-600 to-rose-950"
          />
          <QuickCard
            href="/music/history"
            title={t.music.history}
            subtitle={t.music.recentlyPlayed}
            artworkUrl={data.recentHistory[0]?.track.artworkUrl}
            icon={History}
            tone="from-blue-500 to-indigo-950"
          />
          <QuickCard
            href="/music/tracks"
            title={t.music.allTracks}
            subtitle={t.music.yourCollection}
            artworkUrl={data.recentTracks[1]?.artworkUrl}
            icon={ListMusic}
            tone="from-brand-500 to-cyan-950"
          />
          {firstAlbum && (
            <QuickCard
              href={`/music/albums/${firstAlbum.id}`}
              title={firstAlbum.title}
              subtitle={firstAlbum.artist?.name || t.music.album}
              artworkUrl={firstAlbum.artworkUrl}
              icon={Disc3}
              tone="from-amber-400 to-orange-950"
            />
          )}
          {firstArtist && (
            <QuickCard
              href={`/music/artists/${firstArtist.id}`}
              title={firstArtist.name}
              subtitle={t.music.artist}
              artworkUrl={firstArtist.artworkUrl}
              icon={Radio}
              tone="from-emerald-500 to-teal-950"
            />
          )}
          {data.playlists[0] && (
            <QuickCard
              href={`/music/playlists/${data.playlists[0].id}`}
              title={data.playlists[0].name}
              subtitle={t.music.trackCount(data.playlists[0].itemCount)}
              icon={ListMusic}
              tone="from-violet-500 to-purple-950"
            />
          )}
          <QuickCard
            href="/music/replay"
            title={t.music.replay}
            subtitle={t.music.replayHint}
            icon={BarChart3}
            tone="from-cyan-500 to-violet-950"
          />
          <QuickCard
            href="/music/maintenance"
            title={t.music.libraryCare}
            subtitle={t.music.libraryCareHint}
            icon={Wrench}
            tone="from-zinc-600 to-zinc-950"
          />
        </div>
      </Section>

      {!!discovery?.unfinishedAlbums.length && (
        <Section title={t.music.unfinishedAlbums} eyebrow={t.music.pickUpWhereYouLeftOff}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {discovery.unfinishedAlbums.map((album) => (
              <div key={album.id} className="min-w-0">
                <MusicCollectionCard
                  href={`/music/albums/${album.id}`}
                  title={album.title}
                  subtitle={album.artist?.name}
                  artworkUrl={album.artworkUrl}
                />
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-brand-400"
                    style={{ width: `${Math.round(album.progress * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!discovery?.moodCollections.length && (
        <Section title={t.music.moodsAndGenres} eyebrow={t.music.chooseYourMood}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {discovery.moodCollections.map((item) => (
              <MusicMixCard
                key={item.id}
                mix={item}
                compact
                onPlay={() => player.playTracks(item.tracks)}
              />
            ))}
          </div>
        </Section>
      )}

      {data.recentAlbums.length > 0 && (
        <Section title={t.music.recentAlbums} eyebrow={t.music.freshForYou} href="/music/albums">
          <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {data.recentAlbums.slice(0, 6).map((album) => (
              <MusicCollectionCard
                key={album.id}
                href={`/music/albums/${album.id}`}
                title={album.title}
                subtitle={album.artist?.name}
                artworkUrl={album.artworkUrl}
              />
            ))}
          </div>
        </Section>
      )}

      {data.recentHistory.length > 0 && (
        <Section title={t.music.recentlyPlayed} href="/music/history">
          <MusicTrackList tracks={recentlyPlayedTracks.slice(0, 6)} />
        </Section>
      )}

      {data.artists.length > 0 && (
        <Section title={t.music.artists} eyebrow={t.music.fromYourLibrary} href="/music/artists">
          <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {data.artists.slice(0, 6).map((artist) => (
              <MusicCollectionCard
                key={artist.id}
                href={`/music/artists/${artist.id}`}
                title={artist.name}
                subtitle={t.music.trackCount(artist.trackCount || 0)}
                artworkUrl={artist.artworkUrl}
                round
              />
            ))}
          </div>
        </Section>
      )}

      {data.recentTracks.length > 0 && (
        <Section title={t.music.recentTracks} href="/music/tracks">
          <MusicTrackList tracks={data.recentTracks.slice(0, 8)} />
        </Section>
      )}

      <Section title={t.music.playlists} eyebrow={t.music.madeByYou}>
        <div className="rounded-[28px] border border-white/[0.07] bg-gradient-to-br from-white/[0.055] to-transparent p-5 md:p-7">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = newName.trim();
              if (!name) return;
              createPlaylist.mutate({ name }, { onSuccess: () => setNewName('') });
            }}
            className="flex max-w-xl gap-2"
          >
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t.music.newPlaylist}
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-sm outline-none backdrop-blur focus:border-brand-400"
            />
            <button
              disabled={!newName.trim() || createPlaylist.isPending}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t.music.create}</span>
            </button>
          </form>
          {data.playlists.length ? (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.playlists.map((playlist, index) => (
                <Link
                  key={playlist.id}
                  to={`/music/playlists/${playlist.id}`}
                  className="group flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-3 transition hover:bg-white/[0.06]"
                >
                  <div
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${
                      [
                        'from-violet-500 to-indigo-950',
                        'from-brand-400 to-cyan-950',
                        'from-rose-500 to-fuchsia-950',
                      ][index % 3]
                    }`}
                  >
                    <ListMusic className="h-6 w-6" />
                  </div>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{playlist.name}</span>
                    <span className="mt-1 block text-xs text-white/40">
                      {t.music.trackCount(playlist.itemCount)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-white/35">{t.music.noPlaylists}</p>
          )}
        </div>
      </Section>
    </div>
  );
};

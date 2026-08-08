import React, { useState } from 'react';
import { Heart, History, LibraryBig, ListMusic, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { useCreateMusicPlaylistMutation, useMusicOverviewQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

const Section: React.FC<React.PropsWithChildren<{ title: string; href?: string }>> = ({
  title,
  href,
  children,
}) => (
  <section className="space-y-3">
    <div className="flex items-center justify-between">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {href && (
        <Link to={href} className="text-xs font-semibold text-brand-400">
          {t.common.seeAll}
        </Link>
      )}
    </div>
    {children}
  </section>
);

export const MusicPage: React.FC = () => {
  const query = useMusicOverviewQuery();
  const createPlaylist = useCreateMusicPlaylistMutation();
  const [newName, setNewName] = useState('');
  if (query.isLoading) return <div className="h-80 animate-pulse rounded-2xl bg-zinc-900" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title={t.music.loadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  const data = query.data;
  if (!data || (!data.recentTracks.length && !data.recentAlbums.length))
    return (
      <EmptyState
        icon={LibraryBig}
        title={t.music.emptyTitle}
        description={t.music.emptyDescription}
      />
    );
  return (
    <div className="space-y-8 pb-28">
      <header className="rounded-2xl border border-brand-500/15 bg-gradient-to-br from-brand-900/40 via-[#111315] to-[#090a0b] p-6 md:p-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-brand-400">
          CineDrive Music
        </p>
        <h1 className="font-display text-3xl font-extrabold md:text-5xl">{t.music.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">{t.music.subtitle}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/music/tracks"
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {t.music.allTracks}
          </Link>
          <Link
            to="/music/liked"
            className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm"
          >
            <Heart className="h-4 w-4" />
            {t.music.liked} · {data.favoriteCount}
          </Link>
          <Link
            to="/music/history"
            className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm"
          >
            <History className="h-4 w-4" />
            {t.music.history}
          </Link>
        </div>
      </header>
      {data.recentAlbums.length > 0 && (
        <Section title={t.music.recentAlbums} href="/music/albums">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
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
      {data.recentTracks.length > 0 && (
        <Section title={t.music.recentTracks} href="/music/tracks">
          <MusicTrackList tracks={data.recentTracks.slice(0, 8)} />
        </Section>
      )}
      {data.artists.length > 0 && (
        <Section title={t.music.artists} href="/music/artists">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
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
      <Section title={t.music.playlists}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (!name) return;
            createPlaylist.mutate({ name }, { onSuccess: () => setNewName('') });
          }}
          className="flex max-w-md gap-2"
        >
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t.music.newPlaylist}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <button
            disabled={!newName.trim() || createPlaylist.isPending}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t.music.create}
          </button>
        </form>
        {data.playlists.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.playlists.map((playlist) => (
              <Link
                key={playlist.id}
                to={`/music/playlists/${playlist.id}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#111214] p-4 hover:border-brand-500/30"
              >
                <ListMusic className="h-8 w-8 text-brand-400" />
                <span>
                  <span className="block font-semibold">{playlist.name}</span>
                  <span className="text-xs text-zinc-500">
                    {t.music.trackCount(playlist.itemCount)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{t.music.noPlaylists}</p>
        )}
      </Section>
    </div>
  );
};

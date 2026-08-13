import React, { useState } from 'react';
import { ChevronDown, ExternalLink, ListMusic, ListPlus, Play, Radio, Shuffle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ArtistArtworkFallback } from '../components/music/ArtistArtworkFallback';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { PlaylistDestinationModal } from '../components/music/PlaylistDestinationModal';
import { useArtworkPalette } from '../features/music/useArtworkPalette';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import { rankArtistTracks } from '../features/music/artistPopularity';
import { useArtistRadioMutation, useMusicArtistQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

const albumSection = (album: { releaseType?: string; secondaryTypes?: string[] }) => {
  if (album.secondaryTypes?.includes('compilation')) return 'compilation';
  return ['single', 'ep', 'compilation', 'other'].includes(album.releaseType || '')
    ? album.releaseType || 'other'
    : 'album';
};

export const MusicArtistPage: React.FC = () => {
  const { artistId } = useParams();
  const query = useMusicArtistQuery(artistId);
  const player = useMusicPlayer();
  const radio = useArtistRadioMutation();
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const artist = query.data;
  const palette = useArtworkPalette(artist?.artworkUrl);
  if (!artist) return <div className="h-64 animate-pulse rounded-3xl bg-zinc-900" />;

  const allTracks = [...artist.tracks].sort(
    (left, right) =>
      (right.year || 0) - (left.year || 0) ||
      (left.album?.title || '').localeCompare(right.album?.title || '') ||
      left.discNumber - right.discNumber ||
      left.trackNumber - right.trackNumber ||
      left.title.localeCompare(right.title),
  );
  const popularTracks = rankArtistTracks(artist.tracks);
  const totalPlays = artist.tracks.reduce((total, track) => total + (track.playCount || 0), 0);
  const playlistArtworks = [
    ...new Set(
      artist.tracks.map((track) => track.artworkUrl).filter((url): url is string => !!url),
    ),
  ].slice(0, 4);
  const discography = artist.albums.reduce<Record<string, typeof artist.albums>>(
    (groups, album) => {
      const section = albumSection(album);
      return { ...groups, [section]: [...(groups[section] || []), album] };
    },
    {},
  );

  return (
    <div className="space-y-10 overflow-x-clip pb-32">
      <PlaylistDestinationModal
        tracks={artist.tracks}
        isOpen={playlistOpen}
        onClose={() => setPlaylistOpen(false)}
      />
      <header
        className="relative isolate -mx-4 -mt-4 flex min-h-[430px] items-end overflow-hidden px-5 pb-12 pt-20 sm:-mx-6 sm:px-8 lg:-mx-8 lg:px-12"
        style={{
          backgroundImage: `radial-gradient(circle at 24% 28%, rgb(${palette.primary} / .68), transparent 45%), radial-gradient(circle at 78% 75%, rgb(${palette.secondary} / .3), transparent 48%), linear-gradient(to bottom, rgb(${palette.primary} / .15), #08090b 94%)`,
        }}
      >
        {artist.artworkUrl && (
          <img
            src={artist.artworkUrl}
            alt=""
            className="pointer-events-none absolute inset-0 -z-20 h-full w-full scale-110 object-cover opacity-25 blur-[65px] saturate-150"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-black/25 to-[#08090b]" />
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-7 sm:flex-row sm:items-end">
          <div className="flex h-48 w-48 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/25 shadow-[0_30px_90px_rgba(0,0,0,.6)] sm:h-56 sm:w-56">
            {artist.artworkUrl ? (
              <img src={artist.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ArtistArtworkFallback name={artist.name} />
            )}
          </div>
          <div className="min-w-0 flex-1 text-center sm:pb-2 sm:text-left">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white/50">
              {t.music.artist}
            </p>
            <h1 className="mt-2 text-balance font-display text-5xl font-black tracking-tight sm:text-6xl lg:text-8xl">
              {artist.name}
            </h1>
            <p className="mt-4 text-sm text-white/50">
              {t.music.trackCount(artist.tracks.length)} · {artist.albums.length}{' '}
              {t.music.albums.toLocaleLowerCase()}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <button
                onClick={() => player.playTracks(artist.tracks)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-black shadow-xl transition hover:scale-[1.03]"
              >
                <Play className="h-5 w-5 fill-current" />
                {t.music.playAll}
              </button>
              <button
                onClick={() => player.playShuffledTracks(artist.tracks)}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-5 py-3 font-bold text-white backdrop-blur transition hover:bg-white/10"
              >
                <Shuffle className="h-5 w-5" />
                {t.music.shufflePlay}
              </button>
              <button
                onClick={() =>
                  artistId &&
                  radio.mutate(artistId, {
                    onSuccess: (result) => player.playTracks(result.tracks),
                  })
                }
                disabled={radio.isPending}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-5 py-3 font-bold text-white backdrop-blur transition hover:bg-white/10 disabled:opacity-50"
              >
                <Radio className="h-5 w-5" />
                {t.music.artistRadio}
              </button>
              <button
                type="button"
                onClick={() => setPlaylistOpen(true)}
                aria-label={t.music.addToPlaylist}
                title={t.music.addToPlaylist}
                className="rounded-full border border-white/15 bg-black/20 p-3 text-white/65 backdrop-blur transition hover:bg-white/10 hover:text-white"
              >
                <ListPlus className="h-5 w-5" />
              </button>
              {artist.musicbrainzId && (
                <a
                  href={`https://musicbrainz.org/artist/${artist.musicbrainzId}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="MusicBrainz"
                  className="rounded-full border border-white/15 bg-black/20 p-3 text-white/65 backdrop-blur hover:bg-white/10"
                >
                  <ExternalLink className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      {popularTracks.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl font-black">{t.music.popularTracks}</h2>
              <p className="mt-1.5 text-xs text-zinc-500">{t.music.localPopularTracksHint}</p>
            </div>
            <p className="text-xs tabular-nums text-zinc-600">
              {t.music.artistListeningTotal(totalPlays)}
            </p>
          </div>
          <MusicTrackList tracks={popularTracks} ranked showPlayCount />
        </section>
      )}

      {allTracks.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-3xl font-black">{t.music.artistCollection}</h2>
          <article className="group overflow-hidden rounded-[22px] border border-white/[0.09] bg-[#0d0f12] shadow-[0_22px_60px_rgba(0,0,0,.22)]">
            <div className="relative isolate flex flex-col gap-5 overflow-hidden p-5 sm:flex-row sm:items-center sm:p-6">
              <div
                className="pointer-events-none absolute inset-0 -z-10 opacity-45"
                style={{
                  backgroundImage: `linear-gradient(110deg, rgb(${palette.primary} / .32), transparent 52%, rgb(${palette.secondary} / .18))`,
                }}
              />
              <div className="grid h-28 w-28 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-xl sm:h-36 sm:w-36">
                {playlistArtworks.length ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <img
                      key={`${playlistArtworks[index % playlistArtworks.length]}-${index}`}
                      src={playlistArtworks[index % playlistArtworks.length]}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ))
                ) : artist.artworkUrl ? (
                  <img
                    src={artist.artworkUrl}
                    alt=""
                    className="col-span-2 row-span-2 h-full w-full object-cover"
                  />
                ) : (
                  <span className="col-span-2 row-span-2 flex items-center justify-center">
                    <ListMusic className="h-12 w-12 text-zinc-700" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">
                  {t.music.artistEssentials}
                </p>
                <h3 className="mt-2 truncate font-display text-3xl font-black tracking-tight text-white sm:text-4xl">
                  {t.music.thisIsArtist(artist.name)}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
                  {t.music.artistEssentialsDescription(artist.name, allTracks.length)}
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => player.playTracks(allTracks)}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:scale-[1.02]"
                  >
                    <Play className="h-4 w-4 fill-current" /> {t.music.playAll}
                  </button>
                  <button
                    type="button"
                    onClick={() => player.playShuffledTracks(allTracks)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    <Shuffle className="h-4 w-4" /> {t.music.shufflePlay}
                  </button>
                </div>
              </div>
            </div>

            <details className="group border-t border-white/[0.07]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-zinc-300 transition hover:bg-white/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2.5">
                  <ListMusic className="h-4 w-4 text-brand-300" />
                  {t.music.openArtistTrackList}
                </span>
                <span className="flex items-center gap-3 text-xs font-medium text-zinc-600">
                  {t.music.trackCount(allTracks.length)}
                  <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                </span>
              </summary>
              <div className="border-t border-white/[0.06] p-2 sm:p-4">
                <MusicTrackList tracks={allTracks} />
              </div>
            </details>
          </article>
        </section>
      )}

      <section className="space-y-8">
        <h2 className="font-display text-3xl font-black">{t.music.discography}</h2>
        {['album', 'single', 'ep', 'compilation', 'other'].map((section) =>
          discography[section]?.length ? (
            <div key={section} className="space-y-4">
              <h3 className="font-display text-xl font-bold text-white/75">
                {t.music.releaseTypes[section as keyof typeof t.music.releaseTypes]}
              </h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {discography[section].map((album) => (
                  <MusicCollectionCard
                    key={album.id}
                    href={`/music/albums/${album.id}`}
                    title={album.title}
                    subtitle={album.year?.toString()}
                    artworkUrl={album.artworkUrl}
                  />
                ))}
              </div>
            </div>
          ) : null,
        )}
      </section>

      {artist.similarArtists.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-cyan-300" />
            <h2 className="font-display text-2xl font-bold">{t.music.similarArtists}</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {artist.similarArtists.map((candidate) => (
              <MusicCollectionCard
                key={candidate.id}
                href={`/music/artists/${candidate.id}`}
                title={candidate.name}
                subtitle={
                  candidate.trackCount ? t.music.trackCount(candidate.trackCount) : undefined
                }
                artworkUrl={candidate.artworkUrl}
                round
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

import React from 'react';
import { ExternalLink, Play, Radio, Shuffle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ArtistArtworkFallback } from '../components/music/ArtistArtworkFallback';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useArtworkPalette } from '../features/music/useArtworkPalette';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
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
  const discography = artist.albums.reduce<Record<string, typeof artist.albums>>(
    (groups, album) => {
      const section = albumSection(album);
      return { ...groups, [section]: [...(groups[section] || []), album] };
    },
    {},
  );

  return (
    <div className="space-y-10 pb-32">
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
            <div className="mt-7 flex items-center justify-center gap-3 sm:justify-start">
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

      {allTracks.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-3xl font-black">{t.music.allTracks}</h2>
          <MusicTrackList tracks={allTracks} />
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

import React, { useState } from 'react';
import { Disc3, ExternalLink, ListPlus, Play, Radio, Shuffle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { PlaylistDestinationModal } from '../components/music/PlaylistDestinationModal';
import { useArtworkPalette } from '../features/music/useArtworkPalette';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import { useMusicAlbumQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

const formatLongDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} sa ${minutes} dk` : `${minutes} dk`;
};

export const MusicAlbumPage: React.FC = () => {
  const { albumId } = useParams();
  const query = useMusicAlbumQuery(albumId);
  const player = useMusicPlayer();
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const album = query.data;
  const palette = useArtworkPalette(album?.artworkUrl);
  if (!album) return <div className="h-64 animate-pulse rounded-3xl bg-zinc-900" />;

  const discs = album.tracks.reduce<Record<number, typeof album.tracks>>(
    (groups, track) => ({
      ...groups,
      [track.discNumber]: [...(groups[track.discNumber] || []), track],
    }),
    {},
  );
  const releaseType =
    t.music.releaseTypes[album.releaseType as keyof typeof t.music.releaseTypes] ||
    album.releaseType;

  return (
    <div className="space-y-10 pb-32">
      <PlaylistDestinationModal
        tracks={album.tracks}
        isOpen={playlistOpen}
        onClose={() => setPlaylistOpen(false)}
      />
      <header
        className="relative isolate -mx-4 -mt-4 overflow-hidden px-5 pb-10 pt-16 sm:-mx-6 sm:px-8 lg:-mx-8 lg:px-12"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 20%, rgb(${palette.primary} / .72), transparent 43%), radial-gradient(circle at 82% 72%, rgb(${palette.secondary} / .32), transparent 48%), linear-gradient(to bottom, rgb(${palette.primary} / .22), #08090b 92%)`,
        }}
      >
        {album.artworkUrl && (
          <img
            src={album.artworkUrl}
            alt=""
            className="pointer-events-none absolute inset-0 -z-20 h-full w-full scale-110 object-cover opacity-20 blur-[70px] saturate-150"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-black/25 to-[#08090b]" />
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 sm:flex-row sm:items-end">
          <div className="aspect-square w-[min(72vw,330px)] shrink-0 overflow-hidden rounded-[28px] border border-white/10 bg-black/20 shadow-[0_35px_100px_rgba(0,0,0,.62)]">
            {album.artworkUrl ? (
              <img src={album.artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center">
                <Disc3 className="h-24 w-24 text-white/15" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 text-center sm:pb-2 sm:text-left">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white/50">
              {releaseType}
            </p>
            <h1 className="mt-3 text-balance font-display text-4xl font-black tracking-tight sm:text-5xl lg:text-7xl">
              {album.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-white/55 sm:justify-start">
              {album.artist && (
                <Link
                  to={`/music/artists/${album.artist.id}`}
                  className="font-bold text-white/85 hover:text-cyan-200"
                >
                  {album.artist.name}
                </Link>
              )}
              {album.year && (
                <>
                  <span>·</span>
                  <span>{album.year}</span>
                </>
              )}
              <span>·</span>
              <span>{t.music.trackCount(album.tracks.length)}</span>
              <span>·</span>
              <span>{formatLongDuration(album.totalDuration)}</span>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              <span className="rounded-md bg-black/20 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white/35">
                {t.music.qualitySummary}
              </span>
              {album.qualitySummary.hiRes && (
                <span className="rounded-md border border-cyan-200/30 bg-cyan-200/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-100">
                  {t.music.hiRes}
                </span>
              )}
              {!album.qualitySummary.hiRes && album.qualitySummary.lossless && (
                <span className="rounded-md border border-cyan-200/30 bg-cyan-200/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-100">
                  {t.music.lossless}
                </span>
              )}
              {album.qualitySummary.formats.map((format) => (
                <span
                  key={format}
                  className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-bold text-white/60"
                >
                  {format}
                </span>
              ))}
              {album.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-md bg-white/[0.07] px-2 py-1 text-[10px] font-bold text-white/45"
                >
                  {genre}
                </span>
              ))}
            </div>
            <div className="mt-7 flex items-center justify-center gap-3 sm:justify-start">
              <button
                onClick={() => player.playTracks(album.tracks)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-black shadow-xl transition hover:scale-[1.03]"
              >
                <Play className="h-5 w-5 fill-current" />
                {t.music.playAll}
              </button>
              <button
                onClick={() => player.playShuffledTracks(album.tracks)}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-5 py-3 font-bold text-white backdrop-blur transition hover:bg-white/10"
              >
                <Shuffle className="h-5 w-5" />
                {t.music.shufflePlay}
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
              {album.musicbrainzReleaseGroupId && (
                <a
                  href={`https://musicbrainz.org/release-group/${album.musicbrainzReleaseGroupId}`}
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

      <section className="space-y-7">
        {Object.entries(discs).map(([discNumber, tracks]) => (
          <div key={discNumber} className="space-y-3">
            {album.discCount > 1 && (
              <h2 className="flex items-center gap-2 font-display text-xl font-bold">
                <Disc3 className="h-5 w-5 text-white/40" />
                {t.music.disc(Number(discNumber))}
              </h2>
            )}
            <MusicTrackList tracks={tracks} />
          </div>
        ))}
      </section>

      {album.similarAlbums.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-cyan-300" />
            <h2 className="font-display text-2xl font-bold">{t.music.similarAlbums}</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {album.similarAlbums.map((candidate) => (
              <MusicCollectionCard
                key={candidate.id}
                href={`/music/albums/${candidate.id}`}
                title={candidate.title}
                subtitle={[candidate.artist?.name, candidate.year].filter(Boolean).join(' · ')}
                artworkUrl={candidate.artworkUrl}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

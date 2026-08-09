import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Gauge, ImageOff, Layers3, Save } from 'lucide-react';
import { ErrorState } from '../components/common/ErrorState';
import { MusicTrackList } from '../components/music/MusicTrackList';
import {
  useBulkMusicMetadataMutation,
  useEditMusicAlbumMaintenanceMutation,
  useEditMusicArtistMaintenanceMutation,
  useMusicMaintenanceQuery,
  useReplayGainScanMutation,
} from '../hooks/useMusicApi';
import { t } from '../i18n';

const Stat: React.FC<{ icon: React.ElementType; label: string; value: number; tone: string }> = ({
  icon: Icon,
  label,
  value,
  tone,
}) => (
  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5">
    <div className={`mb-5 inline-flex rounded-xl p-2.5 ${tone}`}>
      <Icon className="h-5 w-5" />
    </div>
    <p className="text-3xl font-black">{value}</p>
    <p className="mt-1 text-xs font-semibold text-white/40">{label}</p>
  </div>
);

export const MusicMaintenancePage: React.FC = () => {
  const query = useMusicMaintenanceQuery();
  const bulk = useBulkMusicMetadataMutation();
  const replayGain = useReplayGainScanMutation();
  const editAlbum = useEditMusicAlbumMaintenanceMutation();
  const editArtist = useEditMusicArtistMaintenanceMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genres, setGenres] = useState('');
  const [year, setYear] = useState('');
  const [artistName, setArtistName] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [albumArtistName, setAlbumArtistName] = useState('');
  const data = query.data;
  const entityTracks = useMemo(() => data?.missingMetadata || [], [data?.missingMetadata]);
  const albums = useMemo(
    () =>
      [
        ...new Map(
          entityTracks
            .filter((track) => track.album)
            .map((track) => [track.album!.id, track.album!]),
        ).values(),
      ].slice(0, 12),
    [entityTracks],
  );
  const artists = useMemo(
    () =>
      [
        ...new Map(
          entityTracks
            .filter((track) => track.primaryArtist)
            .map((track) => [track.primaryArtist!.id, track.primaryArtist!]),
        ).values(),
      ].slice(0, 12),
    [entityTracks],
  );

  if (query.isLoading) return <div className="h-80 animate-pulse rounded-3xl bg-zinc-900" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title={t.music.maintenanceLoadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  if (!data) return null;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-10 pb-32">
      <header className="relative overflow-hidden rounded-[32px] border border-white/[0.08] bg-gradient-to-br from-cyan-950/70 via-zinc-950 to-violet-950/60 p-7 md:p-10">
        <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-brand-400/15 blur-[90px]" />
        <div className="relative max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-300">
            CineDrive Music
          </p>
          <h1 className="mt-3 font-display text-4xl font-black md:text-6xl">
            {t.music.libraryCare}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/50">
            {t.music.maintenanceDescription}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={ImageOff}
          label={t.music.missingArtwork}
          value={data.totals.missingArtwork}
          tone="bg-rose-500/15 text-rose-300"
        />
        <Stat
          icon={AlertTriangle}
          label={t.music.missingMetadata}
          value={data.totals.missingMetadata}
          tone="bg-amber-500/15 text-amber-300"
        />
        <Stat
          icon={Layers3}
          label={t.music.duplicateTracks}
          value={data.totals.duplicates}
          tone="bg-violet-500/15 text-violet-300"
        />
        <Stat
          icon={Gauge}
          label={t.music.replayGainMissing}
          value={data.totals.replayGainMissing}
          tone="bg-cyan-500/15 text-cyan-300"
        />
      </section>

      <section className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">{t.music.bulkMetadata}</h2>
            <p className="mt-1 text-sm text-white/40">{t.music.bulkMetadataHint}</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold">
            {t.music.selectedCount(selected.size)}
          </span>
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <input
            value={artistName}
            onChange={(event) => setArtistName(event.target.value)}
            placeholder={t.music.artistNamePlaceholder}
            className="music-field"
          />
          <input
            value={albumName}
            onChange={(event) => setAlbumName(event.target.value)}
            placeholder={t.music.albumNamePlaceholder}
            className="music-field"
          />
          <input
            value={albumArtistName}
            onChange={(event) => setAlbumArtistName(event.target.value)}
            placeholder={t.music.albumArtistPlaceholder}
            className="music-field"
          />
          <input
            value={genres}
            onChange={(event) => setGenres(event.target.value)}
            placeholder={t.music.genresPlaceholder}
            className="music-field"
          />
          <input
            value={year}
            onChange={(event) => setYear(event.target.value)}
            type="number"
            placeholder={t.music.year}
            className="music-field"
          />
          <button
            disabled={!selected.size || bulk.isPending}
            onClick={() =>
              bulk.mutate({
                trackIds: [...selected],
                artist: artistName.trim() || undefined,
                album: albumName.trim() || undefined,
                albumArtist: albumArtistName.trim() || undefined,
                genres: genres.trim()
                  ? genres
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  : undefined,
                year: year ? Number(year) : undefined,
                metadataLocked: true,
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> {t.common.save}
          </button>
        </div>
        <div className="mt-5 max-h-80 divide-y divide-white/[0.06] overflow-y-auto rounded-2xl border border-white/[0.07]">
          {entityTracks.slice(0, 50).map((track) => (
            <label
              key={track.id}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[0.04]"
            >
              <input
                type="checkbox"
                checked={selected.has(track.id)}
                onChange={() => toggle(track.id)}
                className="h-4 w-4 accent-cyan-400"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{track.title}</span>
                <span className="block truncate text-xs text-white/35">
                  {track.issues
                    .map(
                      (issue) =>
                        t.music.metadataIssues[issue as keyof typeof t.music.metadataIssues] ||
                        issue,
                    )
                    .join(' · ')}
                </span>
              </span>
              <span className="text-xs font-black text-brand-300">{track.confidence}%</span>
            </label>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] p-5 md:p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold">{t.music.replayGainScan}</h2>
              <p className="mt-1 text-sm text-white/40">{t.music.replayGainScanHint}</p>
            </div>
            <button
              onClick={() =>
                replayGain.mutate(data.replayGainMissing.slice(0, 8).map((track) => track.id))
              }
              disabled={!data.replayGainMissing.length || replayGain.isPending}
              className="rounded-full bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:opacity-40"
            >
              {replayGain.isPending ? t.music.scanning : t.music.scanFirstTracks}
            </button>
          </div>
          {replayGain.data && (
            <p className="mt-4 text-xs text-white/50">
              {t.music.replayGainResult(
                replayGain.data.updated.length,
                replayGain.data.skipped.length,
              )}
            </p>
          )}
          <div className="mt-5">
            <MusicTrackList tracks={data.replayGainMissing.slice(0, 5)} />
          </div>
        </div>
        <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] p-5 md:p-7">
          <h2 className="font-display text-2xl font-bold">{t.music.duplicateTracks}</h2>
          <p className="mt-1 text-sm text-white/40">{t.music.duplicateHint}</p>
          <div className="mt-5 space-y-3">
            {data.duplicates.slice(0, 8).map((group) => (
              <details
                key={group.key}
                className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"
              >
                <summary className="cursor-pointer text-sm font-bold">
                  {group.tracks[0]?.title} · {group.tracks.length}
                </summary>
                <div className="mt-3 space-y-2 text-xs text-white/45">
                  {group.tracks.map((track) => (
                    <p key={track.id}>
                      {track.source?.fileName} · {track.source?.library.name}
                    </p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] p-5 md:p-7">
          <h2 className="font-display text-2xl font-bold">{t.music.albumBatchEditor}</h2>
          <div className="mt-5 space-y-2">
            {albums.map((album) => (
              <form
                key={album.id}
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  editAlbum.mutate({
                    id: album.id,
                    title: String(form.get('title') || album.title),
                  });
                }}
              >
                <input name="title" defaultValue={album.title} className="music-field" />
                <button
                  aria-label={t.common.save}
                  className="rounded-xl border border-white/10 px-3 hover:bg-white/10"
                >
                  <Check className="h-4 w-4" />
                </button>
              </form>
            ))}
          </div>
        </div>
        <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] p-5 md:p-7">
          <h2 className="font-display text-2xl font-bold">{t.music.artistBatchEditor}</h2>
          <div className="mt-5 space-y-2">
            {artists.map((artist) => (
              <form
                key={artist.id}
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  editArtist.mutate({
                    id: artist.id,
                    name: String(form.get('name') || artist.name),
                  });
                }}
              >
                <input name="name" defaultValue={artist.name} className="music-field" />
                <button
                  aria-label={t.common.save}
                  className="rounded-xl border border-white/10 px-3 hover:bg-white/10"
                >
                  <Check className="h-4 w-4" />
                </button>
              </form>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

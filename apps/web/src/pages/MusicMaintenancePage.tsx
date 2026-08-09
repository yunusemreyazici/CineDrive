import React, { useMemo, useState } from 'react';
import { AlertTriangle, AudioWaveform, Check, Gauge, ImageOff, Layers3, RotateCcw, Save, Sparkles, X } from 'lucide-react';
import { ErrorState } from '../components/common/ErrorState';
import { MusicTrackList } from '../components/music/MusicTrackList';
import {
  useBulkMusicMetadataMutation,
  useEditMusicAlbumMaintenanceMutation,
  useEditMusicArtistMaintenanceMutation,
  useMusicMaintenanceQuery,
  useReplayGainScanMutation,
  useFingerprintScanMutation,
  useGenerateMusicMaintenanceMutation,
  useResolveMusicSuggestionMutation,
  useArchiveDuplicateMutation,
  useUndoMusicMaintenanceMutation,
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
  const fingerprints = useFingerprintScanMutation();
  const editAlbum = useEditMusicAlbumMaintenanceMutation();
  const editArtist = useEditMusicArtistMaintenanceMutation();
  const generate = useGenerateMusicMaintenanceMutation();
  const resolveSuggestion = useResolveMusicSuggestionMutation();
  const archiveDuplicate = useArchiveDuplicateMutation();
  const undo = useUndoMusicMaintenanceMutation();
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

      <section className="rounded-[28px] border border-cyan-400/15 bg-gradient-to-br from-cyan-950/25 to-violet-950/20 p-5 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="flex items-center gap-2 font-display text-2xl font-bold"><Sparkles className="h-5 w-5 text-cyan-300" /> {t.music.automaticCare}</h2><p className="mt-1 text-sm text-white/40">{t.music.automaticCareHint}</p></div>
          <button onClick={() => generate.mutate()} disabled={generate.isPending} className="rounded-full bg-cyan-300 px-5 py-2.5 text-xs font-black text-black disabled:opacity-50">{generate.isPending ? t.music.scanning : t.music.findSuggestions}</button>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {!data.suggestions?.length && <p className="text-sm text-white/35">{t.music.noSuggestions}</p>}
          {data.suggestions?.map((suggestion) => {
            const proposed = suggestion.proposedData as Record<string, unknown>;
            return <article key={suggestion.id} className="overflow-hidden rounded-2xl border border-white/[.08] bg-black/25 p-4">
              <div className="flex items-start gap-4">
                {suggestion.kind === 'artwork' && typeof proposed.previewUrl === 'string' ? <img src={proposed.previewUrl} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-white/5"><Sparkles className="h-6 w-6 text-cyan-300" /></div>}
                <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wider text-cyan-300">{suggestion.provider} · {suggestion.confidence}%</p><h3 className="mt-1 font-bold">{suggestion.kind === 'artwork' ? t.music.missingArtwork : t.music.missingMetadata}</h3><div className="mt-2 line-clamp-3 break-all text-[11px] leading-5 text-white/35">{Object.entries(proposed).filter(([key]) => key !== 'previewUrl' && key !== 'credits').map(([key, value]) => `${key}: ${String(value ?? '—')}`).join(' · ')}</div></div>
              </div>
              <div className="mt-4 flex gap-2"><button onClick={() => resolveSuggestion.mutate({ id: suggestion.id, accept: true })} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-black text-black"><Check className="h-3.5 w-3.5" /> {t.music.acceptSuggestion}</button><button onClick={() => resolveSuggestion.mutate({ id: suggestion.id, accept: false })} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55"><X className="h-3.5 w-3.5" /> {t.music.rejectSuggestion}</button></div>
            </article>;
          })}
        </div>
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
                    <div key={track.id} className="flex items-center gap-2 rounded-xl bg-white/[.035] p-2">
                      <span className="min-w-0 flex-1 truncate">{track.source?.fileName} · {group.quality?.find((item) => item.trackId === track.id)?.label || track.source?.library.name}</span>
                      {track.id === group.recommendedTrackId ? <span className="rounded-full bg-cyan-300/15 px-2 py-1 text-[9px] font-black text-cyan-200">{t.music.recommendedQuality}</span> : <button onClick={() => group.recommendedTrackId && archiveDuplicate.mutate({ keepTrackId: group.recommendedTrackId, archiveTrackId: track.id, replacePlaylistItems: true })} className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-bold hover:bg-white/10">{t.music.archiveLowerQuality}</button>}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-violet-950/30 via-black/20 to-cyan-950/20 p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><AudioWaveform className="h-6 w-6 text-violet-300" /> {t.music.acousticFingerprint}</h2>
            <p className="mt-2 text-sm leading-6 text-white/40">{t.music.acousticFingerprintHint}</p>
            <p className="mt-2 text-xs font-semibold text-white/55">{t.music.fingerprintsAnalyzed(data.fingerprints.analyzed, data.fingerprints.identified)}</p>
            {!data.fingerprints.available && <p className="mt-2 text-xs text-amber-300">{t.music.fpcalcUnavailable}</p>}
            {data.fingerprints.available && !data.fingerprints.acoustidConfigured && <p className="mt-2 text-xs text-amber-200/70">{t.music.acoustidNotConfigured}</p>}
          </div>
          <button
            onClick={() => fingerprints.mutate({ trackIds: data.fingerprintCandidates.slice(0, 20).map((track) => track.id) })}
            disabled={!data.fingerprints.available || !data.fingerprintCandidates.length || fingerprints.isPending}
            className="rounded-full bg-violet-300 px-5 py-2.5 text-xs font-black text-black disabled:opacity-40"
          >
            {fingerprints.isPending ? t.music.scanning : t.music.scanFingerprints}
          </button>
        </div>
        {fingerprints.data && <p className="mt-4 text-xs text-white/55">{t.music.fingerprintsAnalyzed(fingerprints.data.analyzed.length, fingerprints.data.identified.length)}</p>}
        <div className="mt-6">
          <h3 className="font-display text-lg font-bold">{t.music.acousticDuplicates}</h3>
          <p className="mt-1 text-xs text-white/35">{t.music.acousticDuplicateHint}</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {data.acousticDuplicates.map((group) => (
              <div key={group.key} className="rounded-2xl border border-white/[0.07] bg-black/25 p-4">
                <p className="truncate text-sm font-bold">{group.tracks[0]?.title} · {group.tracks.length}</p>
                <div className="mt-3 space-y-2">
                  {group.tracks.map((track) => (
                    <div key={track.id} className="flex items-center gap-2 rounded-xl bg-white/[.035] p-2 text-xs text-white/45">
                      <span className="min-w-0 flex-1 truncate">{track.title} · {track.source?.fileName}</span>
                      {track.id === group.recommendedTrackId ? <span className="rounded-full bg-violet-300/15 px-2 py-1 text-[9px] font-black text-violet-200">{t.music.recommendedQuality}</span> : <button onClick={() => group.recommendedTrackId && archiveDuplicate.mutate({ keepTrackId: group.recommendedTrackId, archiveTrackId: track.id, replacePlaylistItems: true })} className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-bold hover:bg-white/10">{t.music.archiveLowerQuality}</button>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] p-5 md:p-7">
        <h2 className="font-display text-2xl font-bold">{t.music.actionHistory}</h2>
        <div className="mt-4 divide-y divide-white/[.06]">{data.actions?.map((action) => <div key={action.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{action.actionType}</p><p className="text-xs text-white/35">{new Date(action.createdAt).toLocaleString()}</p></div><button disabled={!!action.revertedAt || undo.isPending} onClick={() => undo.mutate(action.id)} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-xs font-bold disabled:opacity-30"><RotateCcw className="h-3.5 w-3.5" /> {t.music.undoAction}</button></div>)}</div>
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

import React, { useState } from 'react';
import type { MusicTrackCreditDto, MusicTrackDto } from '@cinedrive/shared';
import {
  Database,
  ExternalLink,
  FileAudio,
  Gauge,
  Lock,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import {
  useMusicTrackQuery,
  useRematchMusicTrackMutation,
  useUpdateMusicTrackMetadataMutation,
} from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { formatAudioQuality } from './musicAudio';

interface Props {
  trackId: string;
  fallbackTrack?: MusicTrackDto;
  onClose: () => void;
}

const formatBytes = (value?: string | null) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
};

const roleLabel = (role: string) =>
  t.music.creditRoles[role as keyof typeof t.music.creditRoles] || role;

const Detail: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-xl bg-white/[0.045] px-3 py-2.5">
    <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-white/80">{value || '—'}</dd>
  </div>
);

const MetadataEditor: React.FC<{
  track: MusicTrackDto;
  onDone: () => void;
}> = ({ track, onDone }) => {
  const update = useUpdateMusicTrackMetadataMutation();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.primaryArtist?.name || '');
  const [album, setAlbum] = useState(track.album?.title || '');
  const [year, setYear] = useState(track.year?.toString() || '');
  const [genres, setGenres] = useState(track.genres.join(', '));
  const [discNumber, setDiscNumber] = useState(track.discNumber);
  const [trackNumber, setTrackNumber] = useState(track.trackNumber);
  const [releaseType, setReleaseType] = useState(track.album?.releaseType || 'album');
  const [metadataLocked, setMetadataLocked] = useState(track.metadataLocked !== false);
  const [credits, setCredits] = useState<Array<Omit<MusicTrackCreditDto, 'id' | 'source'>>>(() =>
    (track.credits || []).map(({ name, role, instrument, musicbrainzId }) => ({
      name,
      role,
      instrument,
      musicbrainzId,
    })),
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    update.mutate(
      {
        trackId: track.id,
        metadata: {
          title,
          artist,
          album,
          year: year ? Number(year) : null,
          genres: genres
            .split(',')
            .map((genre) => genre.trim())
            .filter(Boolean),
          discNumber,
          trackNumber,
          releaseType,
          metadataLocked,
          credits: credits
            .filter((credit) => credit.name.trim() && credit.role.trim())
            .map((credit) => ({ ...credit, name: credit.name.trim(), role: credit.role.trim() })),
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="music-field-label">{t.music.trackTitle}</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="music-field"
          />
        </label>
        <label>
          <span className="music-field-label">{t.music.artist}</span>
          <input
            required
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            className="music-field"
          />
        </label>
        <label>
          <span className="music-field-label">{t.music.album}</span>
          <input
            required
            value={album}
            onChange={(event) => setAlbum(event.target.value)}
            className="music-field"
          />
        </label>
        <label>
          <span className="music-field-label">{t.music.year}</span>
          <input
            type="number"
            min={1000}
            max={3000}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            className="music-field"
          />
        </label>
        <label>
          <span className="music-field-label">{t.music.releaseType}</span>
          <select
            value={releaseType}
            onChange={(event) => setReleaseType(event.target.value)}
            className="music-field"
          >
            {['album', 'single', 'ep', 'compilation', 'other'].map((type) => (
              <option key={type} value={type}>
                {t.music.releaseTypes[type as keyof typeof t.music.releaseTypes]}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="music-field-label">{t.music.genres}</span>
          <input
            value={genres}
            onChange={(event) => setGenres(event.target.value)}
            placeholder="Jazz, Vocal"
            className="music-field"
          />
        </label>
        <label>
          <span className="music-field-label">{t.music.discNumber}</span>
          <input
            type="number"
            min={1}
            value={discNumber}
            onChange={(event) => setDiscNumber(Number(event.target.value))}
            className="music-field"
          />
        </label>
        <label>
          <span className="music-field-label">{t.music.trackNumber}</span>
          <input
            type="number"
            min={0}
            value={trackNumber}
            onChange={(event) => setTrackNumber(Number(event.target.value))}
            className="music-field"
          />
        </label>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold">{t.music.credits}</h3>
          <button
            type="button"
            onClick={() =>
              setCredits((items) => [...items, { name: '', role: 'performer', instrument: '' }])
            }
            className="inline-flex items-center gap-1 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" /> {t.common.add}
          </button>
        </div>
        <div className="space-y-2">
          {credits.map((credit, index) => (
            <div
              key={`${index}-${credit.musicbrainzId || ''}`}
              className="grid grid-cols-[1fr_110px_auto] gap-2"
            >
              <input
                aria-label={t.music.creditName}
                value={credit.name}
                onChange={(event) =>
                  setCredits((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
                className="music-field"
              />
              <select
                aria-label={t.music.creditRole}
                value={credit.role}
                onChange={(event) =>
                  setCredits((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, role: event.target.value } : item,
                    ),
                  )
                }
                className="music-field"
              >
                {Object.entries(t.music.creditRoles).map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setCredits((items) => items.filter((_, itemIndex) => itemIndex !== index))
                }
                aria-label={t.common.delete}
                className="rounded-xl p-2 text-white/35 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        role="switch"
        aria-checked={metadataLocked}
        onClick={() => setMetadataLocked((value) => !value)}
        className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left"
      >
        {metadataLocked ? (
          <Lock className="h-4 w-4 text-cyan-300" />
        ) : (
          <Unlock className="h-4 w-4 text-white/40" />
        )}
        <span className="flex-1">
          <span className="block text-sm font-semibold">{t.music.metadataLock}</span>
          <span className="block text-xs text-white/40">{t.music.metadataLockHint}</span>
        </span>
      </button>

      <button
        disabled={update.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 font-bold text-black disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {update.isPending ? t.common.saving : t.common.save}
      </button>
    </form>
  );
};

export const MusicTrackInfoPanel: React.FC<Props> = ({ trackId, fallbackTrack, onClose }) => {
  const query = useMusicTrackQuery(trackId);
  const rematch = useRematchMusicTrackMutation();
  const [editing, setEditing] = useState(false);
  const track = query.data || fallbackTrack;
  const groupedCredits = (track?.credits || []).reduce<Record<string, MusicTrackCreditDto[]>>(
    (groups, credit) => ({ ...groups, [credit.role]: [...(groups[credit.role] || []), credit] }),
    {},
  );

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={t.music.trackInfo}
      className="fixed inset-x-3 bottom-3 top-3 z-[110] ml-auto flex w-[min(560px,calc(100vw-24px))] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#090b0e]/97 text-white shadow-[0_30px_100px_rgba(0,0,0,.8)] backdrop-blur-2xl sm:inset-y-5 sm:right-5"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-cyan-300/10 p-2 text-cyan-300">
            <Music2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold">{t.music.trackInfo}</h2>
            <p className="truncate text-xs text-white/40">{track?.title || t.common.loading}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {track && (
            <button
              onClick={() => setEditing((value) => !value)}
              aria-label={t.common.edit}
              className={`rounded-full p-2 ${editing ? 'bg-cyan-300 text-black' : 'text-white/60 hover:bg-white/10'}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-full p-2 text-white/60 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {!track ? (
          <div className="h-48 animate-pulse rounded-2xl bg-white/5" />
        ) : editing ? (
          <MetadataEditor
            key={`${track.id}-${track.title}`}
            track={track}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                {track.artworkUrl && (
                  <img src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-xl font-bold">{track.title}</h3>
                <p className="mt-1 text-sm text-white/50">{track.primaryArtist?.name}</p>
                <p className="mt-2 text-xs font-semibold text-cyan-200/75">
                  {formatAudioQuality(track)}
                </p>
              </div>
            </div>

            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Gauge className="h-4 w-4 text-cyan-300" />
                {t.music.technicalDetails}
              </h3>
              <dl className="grid grid-cols-2 gap-2">
                <Detail label={t.music.codec} value={track.audio?.codec?.toUpperCase()} />
                <Detail label={t.music.container} value={track.audio?.container?.toUpperCase()} />
                <Detail
                  label={t.music.bitrate}
                  value={
                    track.audio?.bitrate
                      ? `${Math.round(track.audio.bitrate / 1000)} kbps`
                      : undefined
                  }
                />
                <Detail
                  label={t.music.bitDepth}
                  value={track.audio?.bitDepth ? `${track.audio.bitDepth}-bit` : undefined}
                />
                <Detail
                  label={t.music.sampleRate}
                  value={
                    track.audio?.sampleRate ? `${track.audio.sampleRate / 1000} kHz` : undefined
                  }
                />
                <Detail label={t.music.channels} value={track.audio?.channels} />
                <Detail
                  label="ReplayGain Track"
                  value={
                    track.audio?.replayGainTrackDb != null
                      ? `${track.audio.replayGainTrackDb.toFixed(2)} dB`
                      : undefined
                  }
                />
                <Detail
                  label="ReplayGain Album"
                  value={
                    track.audio?.replayGainAlbumDb != null
                      ? `${track.audio.replayGainAlbumDb.toFixed(2)} dB`
                      : undefined
                  }
                />
              </dl>
            </section>

            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Users className="h-4 w-4 text-cyan-300" />
                {t.music.credits}
              </h3>
              {Object.keys(groupedCredits).length ? (
                <div className="space-y-2">
                  {Object.entries(groupedCredits).map(([role, credits]) => (
                    <div key={role} className="rounded-xl bg-white/[0.04] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                        {roleLabel(role)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {credits.map((credit) =>
                          credit.musicbrainzId ? (
                            <a
                              key={credit.id}
                              href={`https://musicbrainz.org/artist/${credit.musicbrainzId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs hover:text-cyan-200"
                            >
                              {credit.name}
                              {credit.instrument ? ` · ${credit.instrument}` : ''}
                            </a>
                          ) : (
                            <span
                              key={credit.id}
                              className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs"
                            >
                              {credit.name}
                              {credit.instrument ? ` · ${credit.instrument}` : ''}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-white/40">
                  {t.music.noCredits}
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <FileAudio className="h-4 w-4 text-cyan-300" />
                {t.music.sourceFile}
              </h3>
              <dl className="grid gap-2">
                <Detail label={t.music.fileName} value={track.source?.fileName} />
                <Detail label={t.music.library} value={track.source?.library.name} />
                <Detail label={t.music.fileSize} value={formatBytes(track.source?.sizeBytes)} />
                {track.source?.localPath && (
                  <Detail
                    label={t.music.filePath}
                    value={<code className="text-xs">{track.source.localPath}</code>}
                  />
                )}
              </dl>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-bold">MusicBrainz</h3>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {track.musicbrainzRecordingId && (
                  <a
                    href={`https://musicbrainz.org/recording/${track.musicbrainzRecordingId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-white/[0.07] px-3 py-2 text-xs"
                  >
                    {t.music.recording}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {track.album?.musicbrainzReleaseGroupId && (
                  <a
                    href={`https://musicbrainz.org/release-group/${track.album.musicbrainzReleaseGroupId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-white/[0.07] px-3 py-2 text-xs"
                  >
                    {t.music.releaseGroup}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <button
                onClick={() => rematch.mutate(track.id)}
                disabled={rematch.isPending}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2.5 text-sm font-semibold text-cyan-200 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${rematch.isPending ? 'animate-spin' : ''}`} />
                {t.music.rematchMetadata}
              </button>
              {rematch.data?.matchStatus === 'not_found' && (
                <p className="mt-2 text-xs text-amber-300">{t.music.noMetadataMatch}</p>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
};

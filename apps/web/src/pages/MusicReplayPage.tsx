import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Headphones,
  Music2,
  Sparkles,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ArtistArtworkFallback } from '../components/music/ArtistArtworkFallback';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { ErrorState } from '../components/common/ErrorState';
import { useMusicReplayQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

type ReplayPeriod = 'week' | 'month' | 'year';

const panelClass = 'rounded-2xl border border-white/[0.07] bg-white/[0.025]';

const getLocale = () => (document.documentElement.lang === 'en' ? 'en-US' : 'tr-TR');

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} ${t.music.replayHourShort} ${minutes} ${t.music.replayMinuteShort}`;
  return `${minutes} ${t.music.replayMinuteShort}`;
};

const formatRange = (start: string, end: string, exclusiveEnd = false) => {
  const locale = getLocale();
  const formatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const endDate = new Date(end);
  if (exclusiveEnd) endDate.setUTCDate(endDate.getUTCDate() - 1);
  const year = new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(endDate);
  return `${formatter.format(new Date(start))} – ${formatter.format(endDate)} ${year}`;
};

const weekdayLabel = (day: number, width: 'short' | 'long' = 'short') =>
  new Intl.DateTimeFormat(getLocale(), { weekday: width }).format(new Date(2024, 0, 7 + day));

const ReplayArtwork: React.FC<{
  src?: string | null;
  name: string;
  round?: boolean;
  className?: string;
}> = ({ src, name, round, className = '' }) => (
  <div
    className={`overflow-hidden bg-zinc-900 ${round ? 'rounded-full' : 'rounded-xl'} ${className}`}
  >
    {src ? (
      <img src={src} alt="" className="h-full w-full object-cover" />
    ) : round ? (
      <ArtistArtworkFallback name={name} compact />
    ) : (
      <span className="flex h-full items-center justify-center text-2xl text-zinc-700">♪</span>
    )}
  </div>
);

const ReplayStat: React.FC<{ icon: LucideIcon; label: string; value: string }> = ({
  icon: Icon,
  label,
  value,
}) => (
  <div className="min-w-0 border-l border-white/[0.07] pl-4 first:border-l-0 first:pl-0 sm:pl-6">
    <div className="flex items-center gap-2 text-zinc-500">
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate text-[11px] font-medium uppercase tracking-wide">{label}</span>
    </div>
    <p className="mt-2 truncate font-display text-xl font-semibold tracking-tight text-white md:text-2xl">
      {value}
    </p>
  </div>
);

export const MusicReplayPage: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [period, setPeriod] = useState<ReplayPeriod>('week');
  const [year, setYear] = useState(currentYear);
  const query = useMusicReplayQuery(period, period === 'year' ? year : undefined);
  const data = query.data;

  const maxHour = useMemo(
    () => Math.max(1, ...(data?.hours.map((item) => item.seconds) || [1])),
    [data],
  );
  const maxDay = useMemo(
    () => Math.max(1, ...(data?.weekdays.map((item) => item.seconds) || [1])),
    [data],
  );
  const peakHour = useMemo(
    () => data?.hours.reduce((best, item) => (item.seconds > best.seconds ? item : best)),
    [data],
  );
  const peakDay = useMemo(
    () => data?.weekdays.reduce((best, item) => (item.seconds > best.seconds ? item : best)),
    [data],
  );

  const downloadCard = () => {
    if (!data) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext('2d');
    if (!context) return;
    const gradient = context.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, '#1c0b18');
    gradient.addColorStop(0.52, '#180d28');
    gradient.addColorStop(1, '#050507');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1080, 1350);
    context.fillStyle = '#fb7185';
    context.font = '700 32px system-ui';
    context.fillText('CINEDRIVE REPLAY', 80, 105);
    context.fillStyle = 'rgba(255,255,255,.55)';
    context.font = '500 28px system-ui';
    context.fillText(
      formatRange(data.range.start, data.range.end, data.period === 'year'),
      80,
      160,
    );
    context.fillStyle = '#ffffff';
    context.font = '900 76px system-ui';
    context.fillText(data.topArtists[0]?.name || 'Your Music', 80, 330, 920);
    context.fillStyle = 'rgba(255,255,255,.55)';
    context.font = '500 30px system-ui';
    context.fillText(t.music.replayTopArtist, 80, 385);
    context.fillStyle = '#ffffff';
    context.font = '800 46px system-ui';
    context.fillText(data.topTracks[0]?.track.title || '—', 80, 560, 920);
    context.fillStyle = 'rgba(255,255,255,.5)';
    context.font = '500 27px system-ui';
    context.fillText(data.topTracks[0]?.track.primaryArtist?.name || '', 80, 610, 920);
    const metrics = [
      [formatDuration(data.totalSeconds), t.music.totalListening],
      [String(data.totalPlays), t.music.totalPlays],
      [String(data.uniqueTracks), t.music.uniqueTracks],
    ];
    metrics.forEach(([value, label], index) => {
      const x = 80 + index * 315;
      context.fillStyle = '#ffffff';
      context.font = '800 42px system-ui';
      context.fillText(value!, x, 805);
      context.fillStyle = 'rgba(255,255,255,.45)';
      context.font = '500 22px system-ui';
      context.fillText(label!, x, 845);
    });
    data.genres.slice(0, 5).forEach((genre, index) => {
      context.fillStyle = 'rgba(255,255,255,.08)';
      context.fillRect(80, 960 + index * 58, 850, 24);
      context.fillStyle = index === 0 ? '#fb7185' : '#a78bfa';
      context.fillRect(
        80,
        960 + index * 58,
        Math.max(8, (genre.seconds / (data.genres[0]?.seconds || 1)) * 850),
        24,
      );
      context.fillStyle = 'rgba(255,255,255,.8)';
      context.font = '600 20px system-ui';
      context.fillText(genre.name, 80, 950 + index * 58);
    });
    const link = document.createElement('a');
    link.download = `cinedrive-replay-${data.year || period}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (query.isLoading)
    return (
      <div className="space-y-5 pb-32">
        <div className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />
          <div className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />
        </div>
      </div>
    );
  if (query.isError)
    return (
      <ErrorState error={query.error} title={t.music.replay} onRetry={() => void query.refetch()} />
    );
  if (!data) return null;

  const stats: Array<{ icon: LucideIcon; label: string; value: string }> = [
    { icon: Clock3, label: t.music.totalListening, value: formatDuration(data.totalSeconds) },
    { icon: Headphones, label: t.music.totalPlays, value: String(data.totalPlays) },
    { icon: Music2, label: t.music.uniqueTracks, value: String(data.uniqueTracks) },
  ];
  const hasHistory = data.totalPlays > 0;
  const topArtist = data.topArtists[0];
  const topTrack = data.topTracks[0];

  return (
    <div className="space-y-7 pb-32">
      <header className="border-b border-white/[0.07] pb-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-300">
              <Sparkles className="h-3.5 w-3.5" /> CineDrive Music
            </p>
            <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-white md:text-5xl">
              {t.music.replay}
            </h1>
            <p className="mt-2 text-sm text-zinc-500">{t.music.replayHint}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div
              className="inline-flex self-start rounded-lg border border-white/[0.08] bg-black/25 p-1"
              role="group"
              aria-label={t.music.replayPeriodLabel}
            >
              {(['week', 'month', 'year'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={period === item}
                  onClick={() => setPeriod(item)}
                  className={`rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
                    period === item
                      ? 'bg-white text-zinc-950 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {t.music.replayPeriods[item]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={downloadCard}
              disabled={!hasHistory}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.09] px-3.5 py-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> {t.music.downloadReplayCard}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatRange(data.range.start, data.range.end, data.period === 'year')}
          </span>
          {period === 'year' && (
            <div className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.025] p-0.5">
              <button
                type="button"
                aria-label={t.music.replayPreviousYear}
                onClick={() => setYear((value) => value - 1)}
                className="rounded p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-12 text-center font-semibold tabular-nums text-zinc-300">
                {year}
              </span>
              <button
                type="button"
                aria-label={t.music.replayNextYear}
                disabled={year >= currentYear}
                onClick={() => setYear((value) => Math.min(currentYear, value + 1))}
                className="rounded p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {!hasHistory ? (
        <section
          className={`${panelClass} flex min-h-80 flex-col items-center justify-center p-8 text-center`}
        >
          <span className="rounded-full border border-white/[0.07] bg-white/[0.03] p-4 text-zinc-600">
            <Headphones className="h-7 w-7" />
          </span>
          <h2 className="mt-5 font-display text-xl font-semibold text-white">
            {t.music.replayNoData}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
            {t.music.replayNoDataHint}
          </p>
        </section>
      ) : (
        <>
          <section className={`${panelClass} overflow-hidden`}>
            <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(290px,0.75fr)]">
              <div className="relative flex min-h-64 items-end overflow-hidden p-5 sm:p-7">
                {topArtist?.artworkUrl && (
                  <img
                    src={topArtist.artworkUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-25 blur-2xl scale-110"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-[#100d11] via-[#100d11]/90 to-[#100d11]/45" />
                <div className="relative flex min-w-0 items-center gap-5">
                  {topArtist && (
                    <ReplayArtwork
                      src={topArtist.artworkUrl}
                      name={topArtist.name}
                      round
                      className="h-28 w-28 shrink-0 border border-white/10 shadow-2xl sm:h-36 sm:w-36"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300">
                      <Trophy className="h-3.5 w-3.5" /> {t.music.replayTopArtist}
                    </p>
                    {topArtist && (
                      <Link
                        to={`/music/artists/${topArtist.id}`}
                        className="mt-3 block truncate font-display text-3xl font-bold tracking-tight text-white hover:text-brand-300 sm:text-4xl"
                      >
                        {topArtist.name}
                      </Link>
                    )}
                    <p className="mt-2 text-sm text-zinc-400">
                      {formatDuration(topArtist?.seconds || 0)} ·{' '}
                      {t.music.playCount(topArtist?.plays || 0)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between border-t border-white/[0.07] p-5 lg:border-l lg:border-t-0 lg:p-7">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {t.music.replayTopTrack}
                  </p>
                  {topTrack && (
                    <div className="mt-4 flex items-center gap-3">
                      <ReplayArtwork
                        src={topTrack.track.artworkUrl}
                        name={topTrack.track.title}
                        className="h-16 w-16 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-zinc-100">
                          {topTrack.track.title}
                        </p>
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {topTrack.track.primaryArtist?.name || t.music.unknownArtist}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-5 text-xs text-zinc-500">
                  {formatDuration(topTrack?.seconds || 0)} ·{' '}
                  {t.music.playCount(topTrack?.plays || 0)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 border-t border-white/[0.07] px-5 py-5 sm:px-7">
              {stats.map((stat) => (
                <ReplayStat key={stat.label} {...stat} />
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className={`${panelClass} p-5 sm:p-6`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-white">
                    {t.music.listeningHours}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">{t.music.replayActivityHint}</p>
                </div>
                {peakHour && (
                  <span className="shrink-0 text-xs font-medium text-zinc-400">
                    {t.music.replayPeak}: {String(peakHour.hour).padStart(2, '0')}:00
                  </span>
                )}
              </div>
              <div className="mt-7 flex h-44 items-end gap-1 sm:gap-1.5">
                {data.hours.map((hour) => (
                  <div
                    key={hour.hour}
                    className="group relative flex h-full min-w-0 flex-1 items-end"
                  >
                    <div
                      title={`${String(hour.hour).padStart(2, '0')}:00 · ${formatDuration(hour.seconds)}`}
                      className={`w-full rounded-sm transition-colors ${
                        hour.seconds === peakHour?.seconds && hour.seconds > 0
                          ? 'bg-brand-400'
                          : 'bg-zinc-700 group-hover:bg-zinc-500'
                      }`}
                      style={{ height: `${Math.max(2, (hour.seconds / maxHour) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-5 text-[10px] tabular-nums text-zinc-600">
                <span>00</span>
                <span className="text-center">06</span>
                <span className="text-center">12</span>
                <span className="text-center">18</span>
                <span className="text-right">23</span>
              </div>
            </div>

            <div className={`${panelClass} p-5 sm:p-6`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-white">
                    {t.music.listeningDays}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">{t.music.replayWeekHint}</p>
                </div>
                {peakDay && (
                  <span className="shrink-0 text-xs font-medium text-zinc-400">
                    {weekdayLabel(peakDay.day, 'long')}
                  </span>
                )}
              </div>
              <div className="mt-6 space-y-3">
                {data.weekdays.map((day) => (
                  <div
                    key={day.day}
                    className="grid grid-cols-[34px_minmax(0,1fr)_52px] items-center gap-3"
                  >
                    <span className="text-xs font-medium text-zinc-500">
                      {weekdayLabel(day.day)}
                    </span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className={`h-full rounded-full ${day.seconds === peakDay?.seconds && day.seconds > 0 ? 'bg-brand-400' : 'bg-zinc-600'}`}
                        style={{ width: `${Math.max(1, (day.seconds / maxDay) * 100)}%` }}
                      />
                    </div>
                    <span className="text-right text-[11px] tabular-nums text-zinc-500">
                      {formatDuration(day.seconds)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className={`${panelClass} p-5 sm:p-6`}>
              <div className="mb-5 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-white">
                  {t.music.topArtists}
                </h2>
                <span className="text-xs text-zinc-600">{data.topArtists.length}</span>
              </div>
              <div>
                {data.topArtists.slice(0, 6).map((artist, index) => (
                  <Link
                    key={artist.id}
                    to={`/music/artists/${artist.id}`}
                    className="group flex items-center gap-3 border-t border-white/[0.06] py-3 first:border-t-0 first:pt-0 last:pb-0"
                  >
                    <span className="w-5 text-center text-xs font-semibold tabular-nums text-zinc-600">
                      {index + 1}
                    </span>
                    <ReplayArtwork
                      src={artist.artworkUrl}
                      name={artist.name}
                      round
                      className="h-11 w-11 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-200 group-hover:text-brand-300">
                        {artist.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-600">
                        {t.music.playCount(artist.plays)}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-zinc-500">
                      {formatDuration(artist.seconds)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-400" />
                  </Link>
                ))}
              </div>
            </div>

            <div className={`${panelClass} p-5 sm:p-6`}>
              <div className="mb-5 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-white">
                  {t.music.topAlbums}
                </h2>
                <span className="text-xs text-zinc-600">{data.topAlbums.length}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {data.topAlbums.slice(0, 6).map((album, index) => (
                  <Link key={album.id} to={`/music/albums/${album.id}`} className="group min-w-0">
                    <div className="relative">
                      <ReplayArtwork
                        src={album.artworkUrl}
                        name={album.title}
                        className="aspect-square w-full transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                      <span className="absolute left-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-md bg-black/70 px-1 text-[10px] font-bold text-white backdrop-blur">
                        {index + 1}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs font-medium text-zinc-300 group-hover:text-brand-300">
                      {album.title}
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-600">
                      {formatDuration(album.seconds)}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
            <div className={`${panelClass} overflow-hidden`}>
              <div className="flex items-baseline justify-between gap-3 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
                <h2 className="font-display text-lg font-semibold text-white">
                  {t.music.topTracks}
                </h2>
                <span className="text-xs text-zinc-600">{data.topTracks.length}</span>
              </div>
              <MusicTrackList tracks={data.topTracks.map((item) => item.track)} homeLayout />
            </div>

            <div className={`${panelClass} p-5 sm:p-6`}>
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-white">
                <BarChart3 className="h-4 w-4 text-zinc-500" /> {t.music.genreDistribution}
              </h2>
              <div className="mt-6 space-y-4">
                {data.genres.map((genre, index) => (
                  <div key={genre.name}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate font-medium text-zinc-300">{genre.name}</span>
                      <span className="shrink-0 tabular-nums text-zinc-600">
                        {formatDuration(genre.seconds)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className={
                          index === 0
                            ? 'h-full rounded-full bg-brand-400'
                            : 'h-full rounded-full bg-zinc-600'
                        }
                        style={{
                          width: `${Math.max(1, (genre.seconds / (data.genres[0]?.seconds || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

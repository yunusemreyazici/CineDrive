import React, { useMemo, useState } from 'react';
import { BarChart3, Clock3, Download, Headphones, Music2, Sparkles, type LucideIcon } from 'lucide-react';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { ErrorState } from '../components/common/ErrorState';
import { useMusicReplayQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} sa ${minutes} dk` : `${minutes} dk`;
};

export const MusicReplayPage: React.FC = () => {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const query = useMusicReplayQuery(period, period === 'year' ? new Date().getFullYear() : undefined);
  const data = query.data;
  const maxHour = useMemo(() => Math.max(1, ...(data?.hours.map((item) => item.seconds) || [1])), [data]);
  const maxDay = useMemo(() => Math.max(1, ...(data?.weekdays.map((item) => item.seconds) || [1])), [data]);
  const downloadCard = () => {
    if (!data) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext('2d');
    if (!context) return;
    const gradient = context.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, '#071b2c');
    gradient.addColorStop(0.5, '#23124a');
    gradient.addColorStop(1, '#030407');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1080, 1350);
    context.fillStyle = '#67e8f9';
    context.font = '700 34px system-ui';
    context.fillText('CINEDRIVE REPLAY', 80, 110);
    context.fillStyle = '#ffffff';
    context.font = '900 92px system-ui';
    context.fillText(String(data.year || new Date().getFullYear()), 80, 240);
    context.font = '800 58px system-ui';
    context.fillText(data.topArtists[0]?.name || 'Your Music', 80, 420, 920);
    context.fillStyle = 'rgba(255,255,255,.62)';
    context.font = '500 34px system-ui';
    context.fillText(`${formatDuration(data.totalSeconds)} · ${data.totalPlays} plays`, 80, 490);
    context.fillStyle = '#ffffff';
    context.font = '800 44px system-ui';
    context.fillText(data.topTracks[0]?.track.title || '—', 80, 650, 920);
    context.fillStyle = 'rgba(255,255,255,.5)';
    context.font = '500 28px system-ui';
    context.fillText(data.topTracks[0]?.track.primaryArtist?.name || '', 80, 700, 920);
    data.genres.slice(0, 5).forEach((genre, index) => {
      context.fillStyle = `hsl(${185 + index * 28} 85% ${70 - index * 4}%)`;
      context.fillRect(80, 820 + index * 70, Math.max(90, (genre.seconds / (data.genres[0]?.seconds || 1)) * 820), 38);
      context.fillStyle = '#ffffff';
      context.font = '600 24px system-ui';
      context.fillText(genre.name, 90, 848 + index * 70);
    });
    const link = document.createElement('a');
    link.download = `cinedrive-replay-${data.year || period}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (query.isLoading) return <div className="h-[520px] animate-pulse rounded-[34px] bg-zinc-900" />;
  if (query.isError) return <ErrorState error={query.error} title={t.music.replay} onRetry={() => void query.refetch()} />;
  if (!data) return null;
  const stats: Array<{ icon: LucideIcon; label: string; value: string }> = [
    { icon: Clock3, label: t.music.totalListening, value: formatDuration(data.totalSeconds) },
    { icon: Headphones, label: t.music.totalPlays, value: String(data.totalPlays) },
    { icon: Music2, label: t.music.uniqueTracks, value: String(data.uniqueTracks) },
  ];
  return (
    <div className="space-y-9 pb-32">
      <header className="relative isolate overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-cyan-950 via-violet-950 to-black p-7 md:p-12">
        <div className="absolute right-0 top-0 -z-10 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-[100px]" />
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.25em] text-cyan-300"><Sparkles className="h-4 w-4" /> CineDrive Music</p>
            <h1 className="mt-4 font-display text-5xl font-black tracking-tight md:text-7xl">{t.music.replay}</h1>
            <p className="mt-3 text-white/50">{t.music.replayHint}</p>
          </div>
          <button onClick={downloadCard} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black"><Download className="h-4 w-4" /> {t.music.downloadReplayCard}</button>
        </div>
        <div className="mt-10 inline-flex rounded-full border border-white/10 bg-black/25 p-1">
          {(['week', 'month', 'year'] as const).map((item) => <button key={item} onClick={() => setPeriod(item)} className={`rounded-full px-5 py-2 text-xs font-bold ${period === item ? 'bg-white text-black' : 'text-white/50'}`}>{t.music.replayPeriods[item]}</button>)}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {stats.map(({ icon: Icon, label, value }) => <div key={label} className="rounded-3xl border border-white/[.07] bg-white/[.035] p-6"><Icon className="h-5 w-5 text-cyan-300" /><p className="mt-6 text-3xl font-black">{value}</p><p className="mt-1 text-xs text-white/40">{label}</p></div>)}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[30px] border border-white/[.07] bg-white/[.025] p-6"><h2 className="mb-5 font-display text-2xl font-bold">{t.music.topArtists}</h2><div className="space-y-3">{data.topArtists.slice(0, 6).map((artist, index) => <div key={artist.id} className="flex items-center gap-4 rounded-2xl bg-white/[.035] p-3"><span className="w-6 text-lg font-black text-white/25">{index + 1}</span>{artist.artworkUrl ? <img src={artist.artworkUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="h-12 w-12 rounded-full bg-violet-500/20" />}<div className="min-w-0 flex-1"><p className="truncate font-bold">{artist.name}</p><p className="text-xs text-white/40">{formatDuration(artist.seconds)}</p></div></div>)}</div></div>
        <div className="rounded-[30px] border border-white/[.07] bg-white/[.025] p-6"><h2 className="mb-5 font-display text-2xl font-bold">{t.music.topAlbums}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{data.topAlbums.slice(0, 6).map((album) => <div key={album.id} className="min-w-0">{album.artworkUrl ? <img src={album.artworkUrl} alt="" className="aspect-square w-full rounded-2xl object-cover" /> : <div className="aspect-square rounded-2xl bg-white/5" />}<p className="mt-2 truncate text-sm font-bold">{album.title}</p></div>)}</div></div>
      </section>

      <section className="rounded-[30px] border border-white/[.07] bg-white/[.025] p-6"><h2 className="mb-5 font-display text-2xl font-bold">{t.music.listeningHours}</h2><div className="flex h-44 items-end gap-1">{data.hours.map((hour) => <div key={hour.hour} title={`${hour.hour}:00 · ${formatDuration(hour.seconds)}`} className="min-w-0 flex-1 rounded-t bg-gradient-to-t from-violet-600 to-cyan-300 transition hover:brightness-125" style={{ height: `${Math.max(3, hour.seconds / maxHour * 100)}%` }} />)}</div><div className="mt-2 flex justify-between text-[10px] text-white/30"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>

      <section className="rounded-[30px] border border-white/[.07] bg-white/[.025] p-6"><h2 className="mb-5 font-display text-2xl font-bold">{t.music.listeningDays}</h2><div className="grid grid-cols-7 gap-2">{data.weekdays.map((day) => <div key={day.day} className="text-center"><div className="flex h-32 items-end rounded-xl bg-white/[.025] p-1"><div className="w-full rounded-lg bg-gradient-to-t from-fuchsia-600 to-cyan-300" style={{ height: `${Math.max(4, day.seconds / maxDay * 100)}%` }} /></div><p className="mt-2 text-[10px] font-bold text-white/45">{new Intl.DateTimeFormat(document.documentElement.lang, { weekday: 'short' }).format(new Date(2024, 0, 7 + day.day))}</p></div>)}</div></section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><div className="rounded-[30px] border border-white/[.07] bg-white/[.025] p-6"><h2 className="mb-4 font-display text-2xl font-bold">Top Tracks</h2><MusicTrackList tracks={data.topTracks.map((item) => item.track)} /></div><div className="rounded-[30px] border border-white/[.07] bg-white/[.025] p-6"><h2 className="mb-5 flex items-center gap-2 font-display text-2xl font-bold"><BarChart3 className="h-5 w-5" /> {t.music.genreDistribution}</h2><div className="space-y-4">{data.genres.map((genre) => <div key={genre.name}><div className="mb-1 flex justify-between text-xs"><span>{genre.name}</span><span className="text-white/35">{formatDuration(genre.seconds)}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-500" style={{ width: `${genre.seconds / (data.genres[0]?.seconds || 1) * 100}%` }} /></div></div>)}</div></div></section>
    </div>
  );
};

import React from 'react';
import { Play } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import { useMusicAlbumQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicAlbumPage: React.FC = () => {
  const { albumId } = useParams(); const query = useMusicAlbumQuery(albumId); const player = useMusicPlayer(); const album = query.data;
  if (!album) return <div className="h-64 animate-pulse rounded-2xl bg-zinc-900" />;
  return <div className="space-y-6 pb-28"><header className="flex flex-col items-center gap-6 rounded-2xl bg-gradient-to-br from-zinc-800/70 to-zinc-950 p-6 text-center sm:flex-row sm:text-left"><div className="h-48 w-48 shrink-0 overflow-hidden rounded-xl bg-zinc-800 shadow-2xl">{album.artworkUrl ? <img src={album.artworkUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-5xl text-zinc-600">♪</span>}</div><div><p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{t.music.album}</p><h1 className="mt-2 font-display text-3xl font-extrabold md:text-5xl">{album.title}</h1><p className="mt-2 text-zinc-400">{album.artist?.name}{album.year ? ` · ${album.year}` : ''} · {t.music.trackCount(album.tracks.length)}</p><button onClick={() => player.playTracks(album.tracks)} className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-3 font-semibold text-white"><Play className="h-5 w-5 fill-current" />{t.music.playAll}</button></div></header><MusicTrackList tracks={album.tracks} /></div>;
};

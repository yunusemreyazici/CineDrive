import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { EmptyState } from '../components/common/EmptyState';
import { useMusicTracksQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicTracksPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const query = useMusicTracksQuery({ search: search || undefined, limit: 200, sortBy: 'title' });
  return <div className="space-y-6 pb-28"><header><h1 className="font-display text-3xl font-extrabold">{t.music.allTracks}</h1><p className="mt-1 text-sm text-zinc-500">{t.music.trackCount(query.data?.pagination.total || 0)}</p></header><label className="flex max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-[#111214] px-3"><Search className="h-4 w-4 text-zinc-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.music.search} className="h-11 flex-1 bg-transparent text-sm outline-none" /></label>{query.data?.tracks.length ? <MusicTrackList tracks={query.data.tracks} /> : !query.isLoading && <EmptyState title={t.music.noTracks} description={t.music.emptyDescription} />}</div>;
};

import React from 'react';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { useMusicArtistsQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicArtistsPage: React.FC = () => { const query = useMusicArtistsQuery(); return <div className="space-y-6 pb-28"><h1 className="font-display text-3xl font-extrabold">{t.music.artists}</h1><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{query.data?.map((artist) => <MusicCollectionCard key={artist.id} href={`/music/artists/${artist.id}`} title={artist.name} subtitle={t.music.trackCount(artist.trackCount || 0)} artworkUrl={artist.artworkUrl} round />)}</div></div>; };

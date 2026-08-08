import React from 'react';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { useMusicAlbumsQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicAlbumsPage: React.FC = () => {
  const query = useMusicAlbumsQuery({ limit: 200 });
  return <div className="space-y-6 pb-28"><h1 className="font-display text-3xl font-extrabold">{t.music.albums}</h1><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{query.data?.map((album) => <MusicCollectionCard key={album.id} href={`/music/albums/${album.id}`} title={album.title} subtitle={album.artist?.name} artworkUrl={album.artworkUrl} />)}</div></div>;
};

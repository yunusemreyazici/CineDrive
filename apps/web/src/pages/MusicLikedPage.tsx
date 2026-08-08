import React from 'react';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useMusicFavoritesQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';
export const MusicLikedPage: React.FC = () => { const query = useMusicFavoritesQuery(); return <div className="space-y-6 pb-28"><h1 className="font-display text-3xl font-extrabold">{t.music.liked}</h1>{query.data && <MusicTrackList tracks={query.data} />}</div>; };

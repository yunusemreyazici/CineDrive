import React from 'react';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useMusicHistoryQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';
export const MusicHistoryPage: React.FC = () => { const query = useMusicHistoryQuery(); const unique = Array.from(new Map((query.data || []).map((item) => [item.track.id, item.track])).values()); return <div className="space-y-6 pb-28"><h1 className="font-display text-3xl font-extrabold">{t.music.history}</h1><MusicTrackList tracks={unique} /></div>; };

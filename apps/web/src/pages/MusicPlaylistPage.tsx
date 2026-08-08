import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { MusicPlaylistDto } from '@cinedrive/shared';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import {
  useMusicPlaylistQuery,
  useRemovePlaylistTrackMutation,
  useReorderPlaylistMutation,
} from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicPlaylistPage: React.FC = () => {
  const { playlistId } = useParams();
  const query = useMusicPlaylistQuery(playlistId);
  const remove = useRemovePlaylistTrackMutation();
  const reorder = useReorderPlaylistMutation();
  const player = useMusicPlayer();
  const [itemOrder, setItemOrder] = useState<string[]>([]);
  if (!query.data) return <div className="h-64 animate-pulse rounded-2xl bg-zinc-900" />;
  const remoteItems: NonNullable<MusicPlaylistDto['items']> = query.data.items || [];
  const itemMap = new Map(remoteItems.map((item) => [item.id, item]));
  const orderedItems =
    itemOrder.length === remoteItems.length && itemOrder.every((id) => itemMap.has(id))
      ? itemOrder.map((id) => itemMap.get(id)!)
      : remoteItems;
  const move = (sourceId: string, targetId: string) => {
    const next = [...orderedItems];
    const source = next.findIndex((item) => item.id === sourceId);
    const target = next.findIndex((item) => item.id === targetId);
    if (source < 0 || target < 0) return;
    const [moved] = next.splice(source, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    const nextOrder = next.map((item) => item.id);
    setItemOrder(nextOrder);
    if (playlistId) reorder.mutate({ playlistId, itemIds: nextOrder });
  };
  return (
    <div className="space-y-6 pb-28">
      <header className="rounded-2xl bg-gradient-to-br from-brand-900/40 to-zinc-950 p-7">
        <p className="text-xs uppercase tracking-widest text-zinc-500">{t.music.playlist}</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold">{query.data.name}</h1>
        <p className="mt-2 text-sm text-zinc-400">{t.music.trackCount(orderedItems.length)}</p>
        {orderedItems.length > 0 && (
          <button
            onClick={() => player.playTracks(orderedItems.map((item) => item.track))}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-500 px-5 py-3 font-semibold"
          >
            <Play className="h-5 w-5 fill-current" />
            {t.music.playAll}
          </button>
        )}
      </header>
      <MusicTrackList
        tracks={orderedItems.map((item) => item.track)}
        playlistItems={orderedItems}
        draggable
        onMoveItem={move}
        onRemoveItem={(itemId) => playlistId && remove.mutate({ playlistId, itemId })}
      />
    </div>
  );
};

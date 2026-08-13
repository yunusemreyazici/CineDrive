import React, { useState } from 'react';
import type { MusicTrackDto } from '@cinedrive/shared';
import {
  GripVertical,
  Heart,
  Info,
  ListEnd,
  MoreHorizontal,
  Play,
  StepForward,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMusicPlayer } from '../../features/music/MusicPlayerProvider';
import {
  useAddPlaylistTrackMutation,
  useMusicPlaylistsQuery,
  useToggleMusicFavoriteMutation,
} from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { MusicTrackInfoPanel } from '../../features/music/MusicTrackInfoPanel';

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return '—';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
};

interface Props {
  tracks: MusicTrackDto[];
  playlistItems?: Array<{ id: string; track: MusicTrackDto }>;
  onRemoveItem?: (id: string) => void;
  draggable?: boolean;
  onMoveItem?: (sourceId: string, targetId: string) => void;
  homeLayout?: boolean;
  ranked?: boolean;
  showPlayCount?: boolean;
}

export const MusicTrackList: React.FC<Props> = ({
  tracks,
  playlistItems,
  onRemoveItem,
  draggable,
  onMoveItem,
  homeLayout,
  ranked,
  showPlayCount,
}) => {
  const player = useMusicPlayer();
  const favorite = useToggleMusicFavoriteMutation();
  const playlists = useMusicPlaylistsQuery();
  const addToPlaylist = useAddPlaylistTrackMutation();
  const [infoTrackId, setInfoTrackId] = useState<string | null>(null);
  return (
    <>
      {infoTrackId && (
        <MusicTrackInfoPanel
          trackId={infoTrackId}
          fallbackTrack={tracks.find((track) => track.id === infoTrackId)}
          onClose={() => setInfoTrackId(null)}
        />
      )}
      <div
        className={
          homeLayout
            ? 'border-y border-white/[0.08] bg-transparent'
            : 'overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e0f11]'
        }
      >
        {homeLayout && (
          <div className="hidden grid-cols-[44px_minmax(160px,1.2fr)_minmax(130px,.7fr)_minmax(130px,.7fr)_58px_76px] gap-4 border-b border-white/[0.06] px-2 py-2 text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 md:grid">
            <span className="col-span-2">{t.music.track}</span>
            <span>{t.music.artist}</span>
            <span>{t.music.album}</span>
            <span aria-hidden="true">◷</span>
            <span />
          </div>
        )}
        {tracks.map((track, index) => {
          // A playlist may intentionally contain the same track more than once.
          // Item order mirrors `tracks`, so index-based lookup preserves each row's identity.
          const playlistItemId = playlistItems?.[index]?.id;
          return (
            <div
              key={playlistItemId || track.id}
              draggable={draggable}
              onDragStart={(event) =>
                playlistItemId && event.dataTransfer.setData('text/plain', playlistItemId)
              }
              onDragOver={(event) => draggable && event.preventDefault()}
              onDrop={(event) => {
                const source = event.dataTransfer.getData('text/plain');
                if (source && playlistItemId && source !== playlistItemId)
                  onMoveItem?.(source, playlistItemId);
              }}
              className={`group grid items-center border-b border-white/[0.05] last:border-0 ${
                homeLayout
                  ? 'grid-cols-[44px_minmax(0,1fr)_auto] gap-3 px-2 py-2 md:grid-cols-[44px_minmax(160px,1.2fr)_minmax(130px,.7fr)_minmax(130px,.7fr)_58px_76px] md:gap-4'
                  : 'grid-cols-[auto_44px_minmax(0,1fr)_auto] gap-3 px-3 py-2.5 md:grid-cols-[auto_44px_minmax(0,1fr)_minmax(120px,.6fr)_60px_auto]'
              }`}
            >
              {!homeLayout &&
                (draggable ? (
                  <GripVertical className="h-4 w-4 cursor-grab text-zinc-700" />
                ) : (
                  <button
                    onClick={() => player.playTracks(tracks, index)}
                    aria-label={t.music.playTrack(track.title)}
                    className="w-5 text-xs text-zinc-600 group-hover:text-brand-400"
                  >
                    <span className="group-hover:hidden">
                      {ranked ? index + 1 : track.trackNumber || index + 1}
                    </span>
                    <Play className="hidden h-4 w-4 fill-current group-hover:block" />
                  </button>
                ))}
              <button
                type="button"
                onClick={() => player.playTracks(tracks, index)}
                aria-label={t.music.playTrack(track.title)}
                className="h-11 w-11 overflow-hidden rounded-lg bg-zinc-800"
              >
                {track.artworkUrl ? (
                  <img src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-zinc-600">♪</span>
                )}
              </button>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => player.playTracks(tracks, index)}
                  className="block max-w-full truncate text-left text-sm font-medium text-zinc-100 transition hover:text-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {track.title}
                </button>
                {!homeLayout &&
                  (showPlayCount ? (
                    <p className="truncate text-xs text-zinc-500 md:hidden">
                      {t.music.playCount(track.playCount || 0)}
                    </p>
                  ) : (
                    track.primaryArtist && (
                      <Link
                        to={`/music/artists/${track.primaryArtist.id}`}
                        className="truncate text-xs text-zinc-500 hover:text-brand-400"
                      >
                        {track.primaryArtist.name}
                      </Link>
                    )
                  ))}
              </div>
              {homeLayout && (
                <div className="hidden min-w-0 md:block">
                  {track.primaryArtist && (
                    <Link
                      to={`/music/artists/${track.primaryArtist.id}`}
                      className="block truncate text-xs text-zinc-500 hover:text-brand-400"
                    >
                      {track.primaryArtist.name}
                    </Link>
                  )}
                </div>
              )}
              <div className="hidden min-w-0 md:block">
                {showPlayCount ? (
                  <span className="text-xs tabular-nums text-zinc-500">
                    {t.music.playCount(track.playCount || 0)}
                  </span>
                ) : (
                  track.album && (
                    <Link
                      to={`/music/albums/${track.album.id}`}
                      className="block truncate text-xs text-zinc-500 hover:text-brand-400"
                    >
                      {track.album.title}
                    </Link>
                  )
                )}
              </div>
              <span className="hidden text-xs tabular-nums text-zinc-600 md:block">
                {formatDuration(track.duration)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => favorite.mutate({ trackId: track.id, favorite: track.isFavorite })}
                  aria-label={track.isFavorite ? t.music.unlike : t.music.like}
                  className={`p-2 ${track.isFavorite ? 'text-brand-400' : 'text-zinc-600 hover:text-white'}`}
                >
                  <Heart className={`h-4 w-4 ${track.isFavorite ? 'fill-current' : ''}`} />
                </button>
                {onRemoveItem && playlistItemId && (
                  <button
                    onClick={() => onRemoveItem(playlistItemId)}
                    aria-label={t.common.delete}
                    className="p-2 text-zinc-600 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <details className="relative">
                  <summary
                    aria-label={t.music.moreActions}
                    className="list-none cursor-pointer rounded-lg p-2 text-zinc-600 hover:text-white"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </summary>
                  <div className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-white/10 bg-zinc-950 p-1.5 shadow-xl">
                    <button
                      onClick={() => setInfoTrackId(track.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5"
                    >
                      <Info className="h-4 w-4" />
                      {t.music.trackInfo}
                    </button>
                    <button
                      onClick={() => player.playNext(track)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5"
                    >
                      <StepForward className="h-4 w-4" />
                      {t.music.playNext}
                    </button>
                    <button
                      onClick={() => player.addToQueue(track)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-white/5"
                    >
                      <ListEnd className="h-4 w-4" />
                      {t.music.addQueue}
                    </button>
                    {playlists.data?.map((playlist) => (
                      <button
                        key={playlist.id}
                        onClick={() =>
                          addToPlaylist.mutate({ playlistId: playlist.id, trackId: track.id })
                        }
                        className="block w-full truncate rounded-lg px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
                      >
                        + {playlist.name}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

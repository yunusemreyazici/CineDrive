import React, { useMemo, useState } from 'react';
import type { MusicPlaylistDto } from '@cinedrive/shared';
import {
  AlertTriangle,
  Clock3,
  Copy,
  GripVertical,
  ListMusic,
  ListPlus,
  Pencil,
  Play,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Modal } from '../components/common/Modal';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { PlaylistDestinationModal } from '../components/music/PlaylistDestinationModal';
import { PlaylistTrackPickerModal } from '../components/music/PlaylistTrackPickerModal';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import {
  useDeleteMusicPlaylistMutation,
  useCreateMusicPlaylistFromTracksMutation,
  useCreateMusicPlaylistMutation,
  useMusicPlaylistQuery,
  useRemovePlaylistTrackMutation,
  useReorderPlaylistMutation,
  useUpdateMusicPlaylistMutation,
} from '../hooks/useMusicApi';
import { t } from '../i18n';
import { toast } from '../stores/useToastStore';

const EMPTY_PLAYLIST_ITEMS: NonNullable<MusicPlaylistDto['items']> = [];

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} sa ${minutes} dk` : `${minutes} dk`;
};

export const MusicPlaylistPage: React.FC = () => {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const query = useMusicPlaylistQuery(playlistId);
  const remove = useRemovePlaylistTrackMutation();
  const reorder = useReorderPlaylistMutation();
  const update = useUpdateMusicPlaylistMutation();
  const deletePlaylist = useDeleteMusicPlaylistMutation();
  const createFromTracks = useCreateMusicPlaylistFromTracksMutation();
  const createPlaylist = useCreateMusicPlaylistMutation();
  const player = useMusicPlayer();
  const [itemOrder, setItemOrder] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addTracksOpen, setAddTracksOpen] = useState(false);
  const [addToAnotherOpen, setAddToAnotherOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  const remoteItems = query.data?.items || EMPTY_PLAYLIST_ITEMS;
  const orderedItems = useMemo(() => {
    const itemMap = new Map(remoteItems.map((item) => [item.id, item]));
    return itemOrder.length === remoteItems.length && itemOrder.every((id) => itemMap.has(id))
      ? itemOrder.map((id) => itemMap.get(id)!)
      : remoteItems;
  }, [itemOrder, remoteItems]);
  const tracks = useMemo(() => orderedItems.map((item) => item.track), [orderedItems]);
  const artworkUrls = useMemo(
    () =>
      [
        ...new Set(
          tracks
            .map((track) => track.artworkUrl)
            .filter((artworkUrl): artworkUrl is string => Boolean(artworkUrl)),
        ),
      ].slice(0, 4),
    [tracks],
  );

  if (!query.data) return <div className="h-64 animate-pulse rounded-2xl bg-zinc-900" />;

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
    if (!playlistId) return;
    reorder.mutate(
      { playlistId, itemIds: nextOrder },
      {
        onError: (error) => {
          setItemOrder([]);
          toast.fromError(error);
        },
      },
    );
  };

  const openEdit = () => {
    setDraftName(query.data.name);
    setDraftDescription(query.data.description || '');
    setEditOpen(true);
  };

  const savePlaylist = async () => {
    if (!playlistId || !draftName.trim()) return;
    try {
      await update.mutateAsync({
        playlistId,
        input: {
          name: draftName.trim(),
          description: draftDescription.trim() || null,
        },
      });
      toast.success(t.music.playlistUpdated);
      setEditOpen(false);
    } catch (error) {
      toast.fromError(error);
    }
  };

  const confirmDelete = async () => {
    if (!playlistId) return;
    try {
      await deletePlaylist.mutateAsync(playlistId);
      toast.success(t.music.playlistDeleted);
      navigate('/music');
    } catch (error) {
      toast.fromError(error);
    }
  };

  const duplicatePlaylist = async () => {
    try {
      const input = {
        name: t.music.playlistCopyName(query.data.name),
        description: query.data.description || undefined,
      };
      const duplicate = tracks.length
        ? await createFromTracks.mutateAsync({
            ...input,
            trackIds: tracks.map((track) => track.id),
          })
        : await createPlaylist.mutateAsync(input);
      toast.success(t.music.playlistDuplicated);
      navigate(`/music/playlists/${duplicate.id}`);
    } catch (error) {
      toast.fromError(error);
    }
  };

  return (
    <div className="space-y-7 pb-28">
      <PlaylistTrackPickerModal
        playlistId={query.data.id}
        playlistName={query.data.name}
        existingTrackIds={tracks.map((track) => track.id)}
        isOpen={addTracksOpen}
        onClose={() => setAddTracksOpen(false)}
      />
      <PlaylistDestinationModal
        tracks={tracks}
        isOpen={addToAnotherOpen}
        onClose={() => setAddToAnotherOpen(false)}
      />
      <header className="relative isolate overflow-hidden rounded-[30px] border border-white/[.07] bg-gradient-to-br from-violet-950/80 via-zinc-950 to-cyan-950/45 p-6 sm:p-8">
        {artworkUrls[0] && (
          <img
            src={artworkUrls[0]}
            alt=""
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-10 blur-3xl"
          />
        )}
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end">
          <div className="aspect-square w-44 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-2xl">
            {artworkUrls.length === 1 ? (
              <img src={artworkUrls[0]} alt="" className="h-full w-full object-cover" />
            ) : artworkUrls.length > 1 ? (
              <div className="grid h-full grid-cols-2">
                {Array.from({ length: 4 }, (_, index) =>
                  artworkUrls[index] ? (
                    <img
                      key={artworkUrls[index]}
                      src={artworkUrls[index]}
                      alt=""
                      className="h-full min-h-0 w-full object-cover"
                    />
                  ) : (
                    <span key={index} className="bg-white/[.04]" />
                  ),
                )}
              </div>
            ) : (
              <span className="flex h-full items-center justify-center">
                <ListMusic className="h-20 w-20 text-white/15" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/45">
              {t.music.playlist}
            </p>
            <h1 className="mt-2 text-balance font-display text-4xl font-black tracking-tight sm:text-6xl">
              {query.data.name}
            </h1>
            {query.data.description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
                {query.data.description}
              </p>
            )}
            <p className="mt-3 flex items-center gap-2 text-sm text-white/45">
              <span>{t.music.trackCount(orderedItems.length)}</span>
              <span>·</span>
              <Clock3 className="h-4 w-4" />
              <span>{formatDuration(query.data.duration)}</span>
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {tracks.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => player.playTracks(tracks)}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-bold text-black transition hover:scale-[1.03]"
                  >
                    <Play className="h-5 w-5 fill-current" />
                    {t.music.playAll}
                  </button>
                  <button
                    type="button"
                    onClick={() => player.playShuffledTracks(tracks)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-5 py-3 font-bold backdrop-blur transition hover:bg-white/10"
                  >
                    <Shuffle className="h-5 w-5" />
                    {t.music.shufflePlay}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setAddTracksOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-4 py-3 text-sm font-bold backdrop-blur transition hover:bg-white/10"
              >
                <ListPlus className="h-5 w-5" />
                {t.music.addTracks}
              </button>
              {tracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAddToAnotherOpen(true)}
                  className="rounded-full border border-white/10 bg-white/[.05] p-3 text-white/65 transition hover:bg-white/10 hover:text-white"
                  aria-label={t.music.addToAnotherPlaylist}
                  title={t.music.addToAnotherPlaylist}
                >
                  <ListPlus className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void duplicatePlaylist()}
                disabled={createFromTracks.isPending || createPlaylist.isPending}
                className="rounded-full border border-white/10 bg-white/[.05] p-3 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                aria-label={t.music.duplicatePlaylist}
                title={t.music.duplicatePlaylist}
              >
                <Copy className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={openEdit}
                className="rounded-full border border-white/10 bg-white/[.05] p-3 text-white/65 transition hover:bg-white/10 hover:text-white"
                aria-label={t.music.editPlaylist}
              >
                <Pencil className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="rounded-full border border-red-300/10 bg-red-500/[.06] p-3 text-red-200/60 transition hover:bg-red-500/15 hover:text-red-100"
                aria-label={t.music.deletePlaylist}
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {orderedItems.length > 0 ? (
        <section className="space-y-3">
          <p className="flex items-center gap-2 px-2 text-xs text-white/35">
            <GripVertical className="h-4 w-4" />
            {t.music.reorderPlaylistHint}
          </p>
          <MusicTrackList
            tracks={tracks}
            playlistItems={orderedItems}
            draggable
            onMoveItem={move}
            onRemoveItem={(itemId) =>
              playlistId &&
              remove.mutate({ playlistId, itemId }, { onError: (error) => toast.fromError(error) })
            }
          />
        </section>
      ) : (
        <section className="flex min-h-52 flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[.02] px-6 text-center">
          <ListMusic className="h-11 w-11 text-white/15" />
          <h2 className="mt-4 font-display text-xl font-bold">{t.music.noTracks}</h2>
          <p className="mt-2 max-w-md text-sm text-white/40">{t.music.playlistEmptyHint}</p>
          <button
            type="button"
            onClick={() => setAddTracksOpen(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black"
          >
            <ListPlus className="h-4 w-4" />
            {t.music.addTracks}
          </button>
        </section>
      )}

      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={t.music.editPlaylist}
        icon={<Pencil className="h-5 w-5 text-cyan-300" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-white/55 hover:bg-white/5"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void savePlaylist()}
              disabled={update.isPending || !draftName.trim()}
              className="rounded-xl bg-white px-5 py-2 text-sm font-bold text-black disabled:opacity-40"
            >
              {update.isPending ? t.common.saving : t.common.save}
            </button>
          </div>
        }
      >
        <div className="space-y-5 p-6">
          <label className="block text-sm font-medium text-white/70">
            {t.music.playlistName}
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={120}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
            />
          </label>
          <label className="block text-sm font-medium text-white/70">
            {t.music.playlistDescription}
            <textarea
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder={t.music.playlistDescriptionPlaceholder}
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-white outline-none placeholder:text-white/25 focus:border-cyan-300/50"
            />
          </label>
        </div>
      </Modal>

      <Modal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t.music.deletePlaylist}
        description={t.music.deletePlaylistConfirm}
        icon={<AlertTriangle className="h-5 w-5 text-red-300" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-white/55 hover:bg-white/5"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deletePlaylist.isPending}
              className="rounded-xl bg-red-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {t.common.delete}
            </button>
          </div>
        }
      >
        <p className="p-6 text-sm leading-6 text-white/55">{query.data.name}</p>
      </Modal>
    </div>
  );
};

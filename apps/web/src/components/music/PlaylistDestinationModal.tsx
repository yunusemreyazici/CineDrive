import React, { useMemo, useState } from 'react';
import type { MusicTrackDto } from '@cinedrive/shared';
import { Check, ListMusic, Loader2, Plus } from 'lucide-react';
import { Modal } from '../common/Modal';
import {
  useAddPlaylistTracksMutation,
  useCreateMusicPlaylistFromTracksMutation,
  useMusicPlaylistsQuery,
} from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { toast } from '../../stores/useToastStore';

interface PlaylistDestinationModalProps {
  tracks: MusicTrackDto[];
  isOpen: boolean;
  onClose: () => void;
}

export const PlaylistDestinationModal: React.FC<PlaylistDestinationModalProps> = ({
  tracks,
  isOpen,
  onClose,
}) => {
  const playlists = useMusicPlaylistsQuery();
  const addTracks = useAddPlaylistTracksMutation();
  const createPlaylist = useCreateMusicPlaylistFromTracksMutation();
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [workingPlaylistId, setWorkingPlaylistId] = useState<string | null>(null);
  const uniqueTracks = useMemo(
    () => [...new Map(tracks.map((track) => [track.id, track])).values()],
    [tracks],
  );
  const trackIds = uniqueTracks.map((track) => track.id);
  const isPending = addTracks.isPending || createPlaylist.isPending;

  const finish = (playlistName: string) => {
    toast.success(t.music.tracksAddedToPlaylist(trackIds.length, playlistName));
    setNewPlaylistName('');
    setWorkingPlaylistId(null);
    onClose();
  };

  const addToPlaylist = async (playlistId: string, playlistName: string) => {
    setWorkingPlaylistId(playlistId);
    try {
      await addTracks.mutateAsync({ playlistId, trackIds });
      finish(playlistName);
    } catch (error) {
      setWorkingPlaylistId(null);
      toast.fromError(error);
    }
  };

  const createAndAdd = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    setWorkingPlaylistId('new');
    try {
      await createPlaylist.mutateAsync({ name, trackIds });
      finish(name);
    } catch (error) {
      setWorkingPlaylistId(null);
      toast.fromError(error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (isPending) return;
        setNewPlaylistName('');
        setWorkingPlaylistId(null);
        onClose();
      }}
      title={t.music.addToPlaylist}
      description={t.music.addTrackCount(trackIds.length)}
      icon={<ListMusic className="h-5 w-5 text-brand-300" />}
      size="sm"
    >
      <div className="space-y-5 p-6">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createAndAdd();
          }}
        >
          <input
            value={newPlaylistName}
            onChange={(event) => setNewPlaylistName(event.target.value)}
            placeholder={t.music.newPlaylist}
            maxLength={120}
            disabled={isPending}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-brand-300/50"
          />
          <button
            type="submit"
            disabled={!newPlaylistName.trim() || isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-black disabled:opacity-40"
          >
            {workingPlaylistId === 'new' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t.music.createAndAdd}
          </button>
        </form>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/35">
            {t.music.choosePlaylist}
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-white/[.07] bg-white/[.02] p-1.5">
            {playlists.isLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              </div>
            ) : playlists.data?.length ? (
              playlists.data.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => void addToPlaylist(playlist.id, playlist.name)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[.06] disabled:opacity-50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-400/10 text-brand-300">
                    <ListMusic className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {playlist.name}
                    </span>
                    <span className="text-xs text-white/35">
                      {t.music.trackCount(playlist.itemCount)}
                    </span>
                  </span>
                  {workingPlaylistId === playlist.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-white/40" />
                  ) : (
                    <Check className="h-4 w-4 text-white/15" />
                  )}
                </button>
              ))
            ) : (
              <p className="px-3 py-7 text-center text-sm text-white/35">{t.music.noPlaylists}</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

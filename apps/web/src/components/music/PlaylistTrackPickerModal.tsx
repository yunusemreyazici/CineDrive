import React, { useMemo, useState } from 'react';
import { CheckCircle2, Circle, ListPlus, Loader2, Search } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useAddPlaylistTracksMutation, useMusicTracksQuery } from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { toast } from '../../stores/useToastStore';

interface PlaylistTrackPickerModalProps {
  playlistId: string;
  playlistName: string;
  existingTrackIds: string[];
  isOpen: boolean;
  onClose: () => void;
}

export const PlaylistTrackPickerModal: React.FC<PlaylistTrackPickerModalProps> = ({
  playlistId,
  playlistName,
  existingTrackIds,
  isOpen,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const tracksQuery = useMusicTracksQuery({
    search: search.trim() || undefined,
    limit: 200,
    sortBy: 'title',
  });
  const addTracks = useAddPlaylistTracksMutation();
  const existing = useMemo(() => new Set(existingTrackIds), [existingTrackIds]);
  const availableTracks = (tracksQuery.data?.tracks || []).filter(
    (track) => !existing.has(track.id),
  );

  const close = () => {
    if (addTracks.isPending) return;
    setSearch('');
    setSelectedTrackIds(new Set());
    onClose();
  };

  const toggle = (trackId: string) => {
    setSelectedTrackIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const save = async () => {
    const trackIds = [...selectedTrackIds];
    if (!trackIds.length) return;
    try {
      await addTracks.mutateAsync({ playlistId, trackIds });
      toast.success(t.music.tracksAddedToPlaylist(trackIds.length, playlistName));
      setSearch('');
      setSelectedTrackIds(new Set());
      onClose();
    } catch (error) {
      toast.fromError(error);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t.music.addTracks}
      icon={<ListPlus className="h-5 w-5 text-brand-300" />}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-white/40">
            {t.music.addTrackCount(selectedTrackIds.size)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              disabled={addTracks.isPending}
              className="rounded-xl px-4 py-2 text-sm font-medium text-white/55 hover:bg-white/5"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!selectedTrackIds.size || addTracks.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-bold text-black disabled:opacity-40"
            >
              {addTracks.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.music.addSelectedTracks(selectedTrackIds.size)}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5 sm:p-6">
        <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4">
          <Search className="h-4 w-4 text-white/30" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.music.searchLibraryTracks}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/25"
          />
        </label>

        <div className="max-h-[52vh] overflow-y-auto rounded-2xl border border-white/[.07] bg-[#0d0e10] p-1.5">
          {tracksQuery.isLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-white/35" />
            </div>
          ) : availableTracks.length ? (
            availableTracks.map((track) => {
              const selected = selectedTrackIds.has(track.id);
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => toggle(track.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[.05]"
                >
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                    {track.artworkUrl ? (
                      <img src={track.artworkUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-zinc-600">
                        ♪
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {track.title}
                    </span>
                    <span className="block truncate text-xs text-white/35">
                      {[track.primaryArtist?.name, track.album?.title].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {selected ? (
                    <CheckCircle2 className="h-5 w-5 text-brand-300" />
                  ) : (
                    <Circle className="h-5 w-5 text-white/20" />
                  )}
                </button>
              );
            })
          ) : (
            <p className="px-4 py-12 text-center text-sm text-white/35">
              {search.trim() ? t.music.noMatchingPlaylistTracks : t.music.noMorePlaylistTracks}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};

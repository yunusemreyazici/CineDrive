import React from 'react';
import { ListPlus, Loader2, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { PlaylistDestinationModal } from '../components/music/PlaylistDestinationModal';
import { EmptyState } from '../components/common/EmptyState';
import { useMusicTracksInfiniteQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicTracksPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const query = useMusicTracksInfiniteQuery({
    search: search || undefined,
    limit: 100,
    sortBy: 'title',
  });
  const [playlistOpen, setPlaylistOpen] = React.useState(false);
  const tracks = query.data?.pages.flatMap((page) => page.tracks) || [];
  const total = query.data?.pages[0]?.pagination.total || 0;

  return (
    <div className="space-y-6 pb-28">
      <PlaylistDestinationModal
        tracks={tracks}
        isOpen={playlistOpen}
        onClose={() => setPlaylistOpen(false)}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">{t.music.allTracks}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t.music.trackCount(total)}</p>
        </div>
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => setPlaylistOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.05] px-4 py-2.5 text-sm font-bold text-white/75 hover:bg-white/10 hover:text-white"
          >
            <ListPlus className="h-4 w-4" />
            {t.music.addToPlaylist}
          </button>
        )}
      </header>
      <label className="flex max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-[#111214] px-3">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          value={search}
          onChange={(event) => {
            const next = event.target.value;
            setSearchParams(next ? { search: next } : {}, { replace: true });
          }}
          placeholder={t.music.search}
          className="h-11 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {tracks.length ? (
        <>
          <MusicTrackList tracks={tracks} />
          {query.hasNextPage && (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.05] px-4 py-2.5 text-sm font-bold text-white/75 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-50"
            >
              {query.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
              {query.isFetchingNextPage ? t.music.loadingMore : t.music.loadMore}
            </button>
          )}
        </>
      ) : (
        !query.isLoading && (
          <EmptyState title={t.music.noTracks} description={t.music.emptyDescription} />
        )
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { ListPlus } from 'lucide-react';
import { PlaylistDestinationModal } from '../components/music/PlaylistDestinationModal';
import { MusicTrackList } from '../components/music/MusicTrackList';
import { useMusicHistoryQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';

export const MusicHistoryPage: React.FC = () => {
  const query = useMusicHistoryQuery();
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const unique = Array.from(
    new Map((query.data || []).map((item) => [item.track.id, item.track])).values(),
  );

  return (
    <div className="space-y-6 pb-28">
      <PlaylistDestinationModal
        tracks={unique}
        isOpen={playlistOpen}
        onClose={() => setPlaylistOpen(false)}
      />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">{t.music.history}</h1>
        {unique.length > 0 && (
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
      <MusicTrackList tracks={unique} />
    </div>
  );
};

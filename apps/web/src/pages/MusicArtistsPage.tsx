import React from 'react';
import { MusicCollectionCard } from '../components/music/MusicCollectionCard';
import { useMusicArtistsQuery } from '../hooks/useMusicApi';
import { t } from '../i18n';
import { MusicCollectionState } from '../components/music/MusicCollectionState';

export const MusicArtistsPage: React.FC = () => {
  const query = useMusicArtistsQuery();
  return (
    <div className="space-y-7">
      <header className="cd-page-heading">
        <h1 className="font-display">{t.music.artists}</h1>
        <p className="cd-eyebrow">{t.music.yourCollection}</p>
      </header>
      <MusicCollectionState
        loading={query.isLoading}
        error={query.error}
        empty={!query.data?.length}
        onRetry={() => void query.refetch()}
      >
        <div className="cd-album-grid">
          {query.data?.map((artist) => (
            <MusicCollectionCard
              key={artist.id}
              href={`/music/artists/${artist.id}`}
              title={artist.name}
              subtitle={t.music.trackCount(artist.trackCount || 0)}
              artworkUrl={artist.artworkUrl}
              round
            />
          ))}
        </div>
      </MusicCollectionState>
    </div>
  );
};

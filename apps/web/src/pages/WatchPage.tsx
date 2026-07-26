import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMediaDetailQuery } from '../hooks/useApi';
import { MediaPlayer } from '../features/player/components/MediaPlayer';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { t } from '../i18n';

export const WatchPage: React.FC = () => {
  const { mediaId, episodeId } = useParams<{ mediaId: string; episodeId?: string }>();
  const navigate = useNavigate();

  const { data: media, isLoading, isError, error, refetch } = useMediaDetailQuery(mediaId);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-zinc-400 font-display">
        <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
        <span>{t.player.preparing}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 p-6">
        <ErrorState
          error={error}
          title={t.player.loadFailed}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 flex items-center justify-center p-6">
        <EmptyState
          title={t.player.notFoundTitle}
          description={t.player.notFoundDescription}
          actionLabel={t.player.goBack}
          onAction={() => navigate(-1)}
        />
      </div>
    );
  }

  return <MediaPlayer media={media} episodeId={episodeId} />;
};

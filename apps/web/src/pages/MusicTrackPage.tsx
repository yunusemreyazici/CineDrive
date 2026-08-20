import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MusicTrackInfoPanel } from '../features/music/MusicTrackInfoPanel';

export const MusicTrackPage: React.FC = () => {
  const { trackId } = useParams<{ trackId: string }>();
  const navigate = useNavigate();

  if (!trackId) return <Navigate to="/music/tracks" replace />;

  return (
    <>
      <div className="min-h-[60vh]" />
      <MusicTrackInfoPanel
        trackId={trackId}
        onClose={() => navigate('/music/tracks', { replace: true })}
      />
    </>
  );
};

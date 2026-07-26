import React, { Suspense } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AppLayout } from '../layouts/AppLayout';
import { t } from '../i18n';
import { HomePage } from '../pages/HomePage';

// Only the dashboard ships in the initial bundle. Every other route — the
// player, the settings tooling, and the login form with its validation stack —
// is fetched on demand so a cold start does not download the whole application.
const LoginPage = React.lazy(() =>
  import('../pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const LibraryPage = React.lazy(() =>
  import('../pages/LibraryPage').then((module) => ({ default: module.LibraryPage })),
);
const MoviesPage = React.lazy(() =>
  import('../pages/MoviesPage').then((module) => ({ default: module.MoviesPage })),
);
const SeriesPage = React.lazy(() =>
  import('../pages/SeriesPage').then((module) => ({ default: module.SeriesPage })),
);
const MediaDetailPage = React.lazy(() =>
  import('../pages/MediaDetailPage').then((module) => ({ default: module.MediaDetailPage })),
);
const PersonPage = React.lazy(() =>
  import('../pages/PersonPage').then((module) => ({ default: module.PersonPage })),
);
const FavoritesPage = React.lazy(() =>
  import('../pages/FavoritesPage').then((module) => ({ default: module.FavoritesPage })),
);
const HistoryPage = React.lazy(() =>
  import('../pages/HistoryPage').then((module) => ({ default: module.HistoryPage })),
);
const SettingsPage = React.lazy(() =>
  import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const WatchPage = React.lazy(() =>
  import('../pages/WatchPage').then((module) => ({ default: module.WatchPage })),
);
const NotFoundPage = React.lazy(() =>
  import('../pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);

const PlayerFallback: React.FC = () => (
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black font-display text-zinc-400">
    <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
    <span>{t.player.preparing}</span>
  </div>
);

const FullScreenFallback: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-zinc-950">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
  </div>
);

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<FullScreenFallback />}>
            <LoginPage />
          </Suspense>
        }
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/movies" element={<MoviesPage />} />
          <Route path="/series" element={<SeriesPage />} />
          <Route path="/media/:mediaId" element={<MediaDetailPage />} />
          <Route path="/person/:personName" element={<PersonPage />} />
          <Route path="/manage" element={<Navigate to="/settings?tab=manage" replace />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/insights" element={<Navigate to="/settings?tab=storage" replace />} />
          <Route path="/media-health" element={<Navigate to="/settings?tab=health" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Video Player (Full Screen) */}
        <Route
          path="/watch/:mediaId"
          element={
            <Suspense fallback={<PlayerFallback />}>
              <WatchPage />
            </Suspense>
          }
        />
        <Route
          path="/watch/:mediaId/:episodeId"
          element={
            <Suspense fallback={<PlayerFallback />}>
              <WatchPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
};

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AppLayout } from '../layouts/AppLayout';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';
import { LibraryPage } from '../pages/LibraryPage';
import { MoviesPage } from '../pages/MoviesPage';
import { SeriesPage } from '../pages/SeriesPage';
import { MediaDetailPage } from '../pages/MediaDetailPage';
import { WatchPage } from '../pages/WatchPage';
import { FavoritesPage } from '../pages/FavoritesPage';
import { HistoryPage } from '../pages/HistoryPage';
import { SettingsPage } from '../pages/SettingsPage';
import { InsightsPage } from '../pages/InsightsPage';
import { MediaHealthPage } from '../pages/MediaHealthPage';
import { MediaManagerPage } from '../pages/MediaManagerPage';
import { PersonPage } from '../pages/PersonPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/movies" element={<MoviesPage />} />
          <Route path="/series" element={<SeriesPage />} />
          <Route path="/media/:mediaId" element={<MediaDetailPage />} />
          <Route path="/person/:personName" element={<PersonPage />} />
          <Route path="/manage" element={<MediaManagerPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/media-health" element={<MediaHealthPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Video Player (Full Screen) */}
        <Route path="/watch/:mediaId" element={<WatchPage />} />
        <Route path="/watch/:mediaId/:episodeId" element={<WatchPage />} />
      </Route>
    </Routes>
  );
};

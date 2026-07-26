import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { User, ArrowLeft, Loader2 } from 'lucide-react';
import { useMediaListQuery } from '../hooks/useApi';
import { MediaCard } from '../components/media/MediaCard';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { t } from '../i18n';

export const PersonPage: React.FC = () => {
  const { personName } = useParams<{ personName: string }>();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<'all' | 'movie' | 'series'>('all');

  const decodedName = personName ? decodeURIComponent(personName) : '';

  const {
    data: mediaData,
    isLoading,
    isError,
    error,
    refetch,
  } = useMediaListQuery({
    person: decodedName,
    limit: 100,
  });

  const allItems = mediaData?.media || [];
  const filteredItems = allItems.filter((item) => {
    if (typeFilter === 'all') return true;
    return item.type === typeFilter;
  });

  const movieCount = allItems.filter((m) => m.type === 'movie').length;
  const seriesCount = allItems.filter((m) => m.type === 'series').length;

  return (
    <div className="space-y-8 pb-20">
      {/* Header Banner */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-3 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-2xl transition-colors"
            title={t.person.goBack}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="w-16 h-16 rounded-2xl bg-brand-600/20 border border-brand-500/30 text-brand-400 flex items-center justify-center font-bold text-2xl shadow-lg shadow-brand-500/10">
            <User className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white font-display">
              {decodedName}
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              {t.person.foundPrefix}{' '}
              <strong className="text-brand-400">{t.person.foundCount(allItems.length)}</strong>{' '}
              {t.person.foundSuffix}
            </p>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              typeFilter === 'all'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.common.all} ({allItems.length})
          </button>
          <button
            onClick={() => setTypeFilter('movie')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              typeFilter === 'movie'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.common.movies} ({movieCount})
          </button>
          <button
            onClick={() => setTypeFilter('series')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              typeFilter === 'series'
                ? 'bg-brand-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.common.seriesPlural} ({seriesCount})
          </button>
        </div>
      </div>

      {/* Media Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500 text-sm gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          <span>{t.person.loading}</span>
        </div>
      ) : isError ? (
        <ErrorState error={error} title={t.person.loadFailed} onRetry={() => void refetch()} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={t.person.notFoundTitle}
          description={t.person.notFoundDescription(decodedName)}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredItems.map((media) => (
            <MediaCard key={media.id} media={media} />
          ))}
        </div>
      )}
    </div>
  );
};

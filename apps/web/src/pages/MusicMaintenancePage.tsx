import type { MusicMaintenanceDto, MusicMaintenanceSuggestionDto } from '@cinedrive/shared';
import {
  Activity,
  AudioWaveform,
  Check,
  CheckCircle2,
  ChevronRight,
  Gauge,
  History,
  Image as ImageIcon,
  Layers3,
  ListMusic,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { ErrorState } from '../components/common/ErrorState';
import { ArtistArtworkFallback } from '../components/music/ArtistArtworkFallback';
import { MusicTrackList } from '../components/music/MusicTrackList';
import {
  useArchiveDuplicateMutation,
  useBulkMusicMetadataMutation,
  useEditMusicAlbumMaintenanceMutation,
  useEditMusicArtistMaintenanceMutation,
  useFingerprintScanMutation,
  useGenerateMusicMaintenanceMutation,
  useMusicMaintenanceQuery,
  useReplayGainScanMutation,
  useResolveMusicSuggestionMutation,
  useScanArtistArtworkMutation,
  useUndoMusicMaintenanceMutation,
} from '../hooks/useMusicApi';
import { t } from '../i18n';
import { toast } from '../stores/useToastStore';

type MaintenanceTab = 'overview' | 'artwork' | 'metadata' | 'audio' | 'activity';
type Artist = MusicMaintenanceDto['artists'][number];

const Panel: React.FC<
  React.PropsWithChildren<{ className?: string; accent?: 'cyan' | 'violet' | 'amber' }>
> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-zinc-800/70 bg-zinc-950/45 ${className}`}>
    {children}
  </section>
);

const MaintenanceSummary: React.FC<{
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}> = ({ icon: Icon, label, value }) => (
  <div className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-800/70 bg-zinc-950/50 px-4 py-3">
    <span className="rounded-lg bg-zinc-900 p-2 text-zinc-500">
      <Icon className="h-4 w-4" />
    </span>
    <div className="min-w-0">
      <p className="truncate text-lg font-semibold leading-none text-zinc-100">{value}</p>
      <p className="mt-1 truncate text-xs text-zinc-500">{label}</p>
    </div>
  </div>
);

const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  detail: string;
}> = ({ icon: Icon, title, detail }) => (
  <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/30 px-6 text-center">
    <Icon className="h-6 w-6 text-zinc-600" />
    <p className="mt-3 text-sm font-semibold text-zinc-300">{title}</p>
    <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">{detail}</p>
  </div>
);

const SuggestionCard: React.FC<{
  suggestion: MusicMaintenanceSuggestionDto;
  title: string;
  busy: boolean;
  onResolve: (accept: boolean) => void;
}> = ({ suggestion, title, busy, onResolve }) => {
  const proposed = suggestion.proposedData as Record<string, unknown>;
  const preview = typeof proposed.previewUrl === 'string' ? proposed.previewUrl : undefined;
  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-4">
      <div className="flex items-start gap-4">
        {preview ? (
          <img src={preview} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/5">
            <WandSparkles className="h-6 w-6 text-cyan-300" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.18em] text-cyan-300">
            <span>{suggestion.provider}</span>
            <span className="h-1 w-1 rounded-full bg-white/20" />
            <span>{suggestion.confidence}%</span>
          </div>
          <h3 className="mt-2 truncate font-bold">{title}</h3>
          <p className="mt-2 line-clamp-2 break-all text-[11px] leading-5 text-white/35">
            {Object.entries(proposed)
              .filter(([key]) => !['previewUrl', 'credits', 'sourceUrl'].includes(key))
              .map(([key, value]) => `${key}: ${String(value ?? '—')}`)
              .join(' · ')}
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> {t.music.acceptSuggestion}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(false)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800/60 disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" /> {t.music.rejectSuggestion}
        </button>
      </div>
    </article>
  );
};

const lookupTone: Record<string, string> = {
  found: 'bg-emerald-300/10 text-emerald-200',
  'not-found': 'bg-amber-300/10 text-amber-200',
  failed: 'bg-rose-300/10 text-rose-200',
  'manual-skip': 'bg-white/[.07] text-white/45',
  pending: 'bg-cyan-300/10 text-cyan-200',
};

export const MusicMaintenancePage: React.FC = () => {
  const query = useMusicMaintenanceQuery();
  const generate = useGenerateMusicMaintenanceMutation();
  const artworkScan = useScanArtistArtworkMutation();
  const resolveSuggestion = useResolveMusicSuggestionMutation();
  const bulk = useBulkMusicMetadataMutation();
  const replayGain = useReplayGainScanMutation();
  const fingerprints = useFingerprintScanMutation();
  const editAlbum = useEditMusicAlbumMaintenanceMutation();
  const editArtist = useEditMusicArtistMaintenanceMutation();
  const archiveDuplicate = useArchiveDuplicateMutation();
  const undo = useUndoMusicMaintenanceMutation();
  const [activeTab, setActiveTab] = useState<MaintenanceTab>('overview');
  const [artistQuery, setArtistQuery] = useState('');
  const [artistScope, setArtistScope] = useState<'missing' | 'all'>('missing');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genres, setGenres] = useState('');
  const [year, setYear] = useState('');
  const [artistName, setArtistName] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [albumArtistName, setAlbumArtistName] = useState('');
  const data = query.data;

  const entityTracks = useMemo(() => data?.missingMetadata || [], [data?.missingMetadata]);
  const artists = useMemo(() => data?.artists || [], [data?.artists]);
  const artistById = useMemo(
    () => new Map(artists.map((artist) => [artist.id, artist])),
    [artists],
  );
  const trackById = useMemo(
    () => new Map(entityTracks.map((track) => [track.id, track])),
    [entityTracks],
  );
  const suggestions = useMemo(() => {
    const unique = new Map<string, MusicMaintenanceSuggestionDto>();
    for (const suggestion of data?.suggestions || []) {
      const key = `${suggestion.targetType}:${suggestion.targetId}:${suggestion.kind}`;
      if (!unique.has(key)) unique.set(key, suggestion);
    }
    return [...unique.values()];
  }, [data?.suggestions]);
  const artworkSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.kind === 'artwork'),
    [suggestions],
  );
  const metadataSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.kind !== 'artwork'),
    [suggestions],
  );
  const albums = useMemo(
    () =>
      [
        ...new Map(
          entityTracks
            .filter((track) => track.album)
            .map((track) => [track.album!.id, track.album!]),
        ).values(),
      ].slice(0, 20),
    [entityTracks],
  );
  const filteredArtists = useMemo(() => {
    const normalizedQuery = artistQuery.trim().toLocaleLowerCase('tr-TR');
    return artists.filter(
      (artist) =>
        (artistScope === 'all' || !artist.artworkUrl) &&
        (!normalizedQuery || artist.name.toLocaleLowerCase('tr-TR').includes(normalizedQuery)),
    );
  }, [artistQuery, artistScope, artists]);

  if (query.isLoading)
    return <div className="h-[620px] animate-pulse rounded-[36px] bg-zinc-900" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        title={t.music.maintenanceLoadFailed}
        onRetry={() => void query.refetch()}
      />
    );
  if (!data) return null;

  const totalIssues =
    data.totals.missingArtistArtwork +
    data.totals.missingArtwork +
    data.totals.missingMetadata +
    data.totals.duplicates +
    data.totals.replayGainMissing;
  const artworkCount = artists.filter((artist) => !!artist.artworkUrl).length;
  const tabs: Array<{
    id: MaintenanceTab;
    label: string;
    icon: React.ElementType;
    count?: number;
  }> = [
    { id: 'overview', label: t.music.maintenanceOverview, icon: Activity },
    {
      id: 'artwork',
      label: t.music.maintenanceArtwork,
      icon: ImageIcon,
      count: data.totals.missingArtistArtwork,
    },
    {
      id: 'metadata',
      label: t.music.maintenanceMetadata,
      icon: ListMusic,
      count: data.totals.missingMetadata,
    },
    {
      id: 'audio',
      label: t.music.maintenanceAudio,
      icon: AudioWaveform,
      count: data.totals.duplicates + data.totals.replayGainMissing,
    },
    { id: 'activity', label: t.music.maintenanceActivity, icon: History },
  ];

  const resolve = (suggestion: MusicMaintenanceSuggestionDto, accept: boolean) =>
    resolveSuggestion.mutate(
      { id: suggestion.id, accept },
      {
        onSuccess: () =>
          toast.success(accept ? t.music.suggestionAccepted : t.music.suggestionRejected),
        onError: (error) => toast.fromError(error),
      },
    );

  const scanArtwork = (artistIds?: string[]) =>
    artworkScan.mutate(
      { artistIds, limit: 12 },
      {
        onSuccess: (result) => {
          const detail = t.music.artistArtworkScanDetail(result.notFound, result.failed);
          if (result.found)
            toast.success(t.music.artistArtworkScanResult(result.found, result.scanned), detail);
          else toast.info(t.music.artistArtworkScanEmpty(result.scanned), detail);
        },
        onError: (error) => toast.fromError(error, t.music.artistArtworkScanFailed),
      },
    );

  const smartScan = () =>
    generate.mutate(
      {},
      {
        onSuccess: (result) =>
          toast.success(t.music.smartScanComplete, t.music.smartScanResult(result.generated)),
        onError: (error) => toast.fromError(error),
      },
    );

  const toggleTrack = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const uploadArtistArtwork = (artist: Artist, file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return;
      editArtist.mutate(
        { id: artist.id, name: artist.name, artworkData: reader.result },
        {
          onSuccess: () => toast.success(t.music.artistArtworkUploaded),
          onError: (error) => toast.fromError(error),
        },
      );
    });
    reader.readAsDataURL(file);
  };

  return (
    <div className="pb-32">
      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/25">
        <header className="p-4 md:px-7 md:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-2.5 text-brand-400">
                <Activity className="h-5 w-5" />
              </span>
              <div>
                <h1 className="font-display text-lg font-semibold text-white">
                  {t.music.libraryCare}
                </h1>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-zinc-500">
                  {t.music.maintenanceDescriptionNew}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={smartScan}
              disabled={generate.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
            >
              {generate.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {generate.isPending ? t.music.scanning : t.music.smartScan}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <MaintenanceSummary
              icon={Activity}
              label={t.music.maintenanceControlCenter}
              value={totalIssues}
            />
            <MaintenanceSummary
              icon={UserRound}
              label={t.music.missingArtistArtwork}
              value={data.totals.missingArtistArtwork}
            />
            <MaintenanceSummary
              icon={ListMusic}
              label={t.music.missingMetadata}
              value={data.totals.missingMetadata}
            />
            <MaintenanceSummary
              icon={Layers3}
              label={t.music.duplicateTracks}
              value={data.totals.duplicates}
            />
            <MaintenanceSummary
              icon={History}
              label={t.music.pendingReview}
              value={suggestions.length}
            />
          </div>
        </header>

        <nav className="scrollbar-none flex gap-1 overflow-x-auto border-y border-zinc-800/70 bg-zinc-950/60 p-2">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              type="button"
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                activeTab === id
                  ? 'bg-brand-500/10 text-brand-300'
                  : 'text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {!!count && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === id ? 'bg-brand-500/15' : 'bg-zinc-800'}`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-w-0 p-4 md:px-7 md:py-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
                <Panel className="p-5" accent="cyan">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                        {t.music.recommendedNextStep}
                      </p>
                      <h2 className="mt-2 font-display text-[15px] font-semibold text-white">
                        {t.music.completeArtistArtwork}
                      </h2>
                      <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-zinc-500">
                        {t.music.completeArtistArtworkHint}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => scanArtwork()}
                      disabled={artworkScan.isPending || !data.totals.missingArtistArtwork}
                      className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                    >
                      {artworkScan.isPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      {artworkScan.isPending ? t.music.scanning : t.music.scanNextArtists}
                    </button>
                  </div>
                  <div className="mt-5 grid grid-cols-3 divide-x divide-zinc-800/70 border-t border-zinc-800/70 pt-4">
                    <div className="px-3 first:pl-0">
                      <p className="text-xl font-semibold text-zinc-100">{artworkCount}</p>
                      <p className="mt-1 text-xs text-zinc-500">{t.music.artworkReady}</p>
                    </div>
                    <div className="px-3">
                      <p className="text-xl font-semibold text-zinc-100">
                        {
                          artists.filter((artist) => artist.artworkLookupStatus === 'not-found')
                            .length
                        }
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">{t.music.sourceUnavailable}</p>
                    </div>
                    <div className="px-3">
                      <p className="text-xl font-semibold text-zinc-100">
                        {
                          artists.filter((artist) => !artist.artworkLookupAt && !artist.artworkUrl)
                            .length
                        }
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">{t.music.waitingForScan}</p>
                    </div>
                  </div>
                </Panel>

                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-[15px] font-semibold">
                        {t.music.pendingReview}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500">{t.music.pendingReviewHint}</p>
                    </div>
                    <span className="text-xs font-medium text-zinc-500">{suggestions.length}</span>
                  </div>
                  <div className="mt-5 space-y-2">
                    {suggestions.slice(0, 4).map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion.id}
                        onClick={() =>
                          setActiveTab(suggestion.kind === 'artwork' ? 'artwork' : 'metadata')
                        }
                        className="flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left hover:border-zinc-800 hover:bg-zinc-900/40"
                      >
                        <span className="rounded-lg bg-cyan-300/10 p-2 text-cyan-200">
                          {suggestion.kind === 'artwork' ? (
                            <ImageIcon className="h-4 w-4" />
                          ) : (
                            <ListMusic className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">
                            {artistById.get(suggestion.targetId)?.name ||
                              trackById.get(suggestion.targetId)?.title ||
                              suggestion.provider}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-zinc-600">
                            {suggestion.provider} · {suggestion.confidence}%
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-zinc-700" />
                      </button>
                    ))}
                    {!suggestions.length && (
                      <EmptyState
                        icon={CheckCircle2}
                        title={t.music.noSuggestions}
                        detail={t.music.noSuggestionsHint}
                      />
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {activeTab === 'artwork' && (
            <div className="space-y-6">
              <Panel className="p-5" accent="cyan">
                <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-lg bg-zinc-900 p-2 text-zinc-500">
                        <ImageIcon className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="font-display text-[15px] font-semibold">
                          {t.music.artistArtworkStudio}
                        </h2>
                        <p className="mt-1 text-[13px] text-zinc-500">
                          {t.music.artistArtworkStudioHint}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="border-r border-zinc-800/70 pr-3">
                      <p className="text-lg font-semibold">
                        {artworkCount}
                        <span className="text-sm text-zinc-600">/{artists.length}</span>
                      </p>
                      <p className="text-xs text-zinc-500">{t.music.artworkCoverage}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => scanArtwork()}
                      disabled={artworkScan.isPending || !data.totals.missingArtistArtwork}
                      className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                    >
                      {artworkScan.isPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      {artworkScan.isPending ? t.music.scanning : t.music.scanNextArtists}
                    </button>
                  </div>
                </div>
                {artworkScan.data && (
                  <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-3 text-xs font-medium">
                    <span className="text-zinc-500">
                      {t.music.scannedCount(artworkScan.data.scanned)}
                    </span>
                    <span className="text-emerald-200">
                      {t.music.foundCount(artworkScan.data.found)}
                    </span>
                    <span className="text-amber-200">
                      {t.music.notFoundCount(artworkScan.data.notFound)}
                    </span>
                    {!!artworkScan.data.failed && (
                      <span className="text-rose-200">
                        {t.music.failedCount(artworkScan.data.failed)}
                      </span>
                    )}
                  </div>
                )}
              </Panel>

              {!!artworkSuggestions.length && (
                <Panel className="p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-[15px] font-semibold">
                        {t.music.previouslyFoundArtwork}
                      </h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        {t.music.previouslyFoundArtworkHint}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-zinc-500">
                      {artworkSuggestions.length}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {artworkSuggestions.map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        title={artistById.get(suggestion.targetId)?.name || t.music.artist}
                        busy={resolveSuggestion.isPending}
                        onResolve={(accept) => resolve(suggestion, accept)}
                      />
                    ))}
                  </div>
                </Panel>
              )}

              <Panel className="p-5">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div>
                    <h2 className="font-display text-[15px] font-semibold">
                      {t.music.artistLibrary}
                    </h2>
                    <p className="mt-1 text-[13px] text-zinc-500">{t.music.artistLibraryHint}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex min-w-52 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-zinc-500 focus-within:border-brand-500">
                      <Search className="h-4 w-4" />
                      <input
                        value={artistQuery}
                        onChange={(event) => setArtistQuery(event.target.value)}
                        placeholder={t.music.searchArtists}
                        className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
                      />
                    </label>
                    <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                      {(['missing', 'all'] as const).map((scope) => (
                        <button
                          type="button"
                          key={scope}
                          onClick={() => setArtistScope(scope)}
                          className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${
                            artistScope === scope
                              ? 'bg-brand-500/10 text-brand-300'
                              : 'text-zinc-500'
                          }`}
                        >
                          {scope === 'missing' ? t.music.missingOnly : t.music.allArtists}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {filteredArtists.map((artist) => {
                    const status = artist.artworkUrl
                      ? 'found'
                      : artist.artworkLookupStatus || 'pending';
                    return (
                      <article
                        key={artist.id}
                        className="group rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
                      >
                        <div className="flex gap-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-800">
                            {artist.artworkUrl ? (
                              <img
                                src={artist.artworkUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <ArtistArtworkFallback name={artist.name} compact />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 py-1">
                            <form
                              className="flex gap-1"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                editArtist.mutate(
                                  {
                                    id: artist.id,
                                    name: String(form.get('name') || artist.name),
                                  },
                                  {
                                    onSuccess: () => toast.success(t.music.artistUpdated),
                                    onError: (error) => toast.fromError(error),
                                  },
                                );
                              }}
                            >
                              <input
                                name="name"
                                defaultValue={artist.name}
                                className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none focus:text-cyan-200"
                              />
                              <button
                                type="submit"
                                aria-label={t.common.save}
                                className="rounded-md p-1.5 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100 focus:opacity-100"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </form>
                            <span
                              className={`mt-2 inline-flex rounded-full px-2 py-1 text-[9px] font-black ${lookupTone[status] || lookupTone.pending}`}
                            >
                              {t.music.artistLookupStatuses[
                                status as keyof typeof t.music.artistLookupStatuses
                              ] || status}
                            </span>
                            <p className="mt-2 truncate text-[10px] text-zinc-600">
                              {artist.artworkSource ||
                                (artist.musicbrainzId ? 'MusicBrainz' : t.music.noIdentity)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {!artist.artworkUrl && (
                            <button
                              type="button"
                              onClick={() => scanArtwork([artist.id])}
                              disabled={artworkScan.isPending}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                            >
                              <Sparkles className="h-3.5 w-3.5" /> {t.music.findArtistArtwork}
                            </button>
                          )}
                          <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800/60">
                            <Upload className="h-3.5 w-3.5" /> {t.music.uploadArtistArtwork}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={(event) =>
                                uploadArtistArtwork(artist, event.currentTarget.files?.[0])
                              }
                            />
                          </label>
                          {artist.artworkUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                editArtist.mutate(
                                  { id: artist.id, name: artist.name, removeArtwork: true },
                                  {
                                    onSuccess: () => toast.success(t.music.artistArtworkRemoved),
                                    onError: (error) => toast.fromError(error),
                                  },
                                )
                              }
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-medium text-zinc-400 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> {t.music.removeArtistArtwork}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!filteredArtists.length && (
                  <div className="mt-6">
                    <EmptyState
                      icon={CheckCircle2}
                      title={t.music.noArtistsInFilter}
                      detail={t.music.noArtistsInFilterHint}
                    />
                  </div>
                )}
              </Panel>
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
                <Panel className="p-5" accent="amber">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-[15px] font-semibold">
                        {t.music.metadataWorkspace}
                      </h2>
                      <p className="mt-1 text-[13px] text-zinc-500">{t.music.bulkMetadataHint}</p>
                    </div>
                    <span className="text-xs font-medium text-zinc-500">
                      {t.music.selectedCount(selected.size)}
                    </span>
                  </div>
                  <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    <input
                      value={artistName}
                      onChange={(event) => setArtistName(event.target.value)}
                      placeholder={t.music.artistNamePlaceholder}
                      className="music-field"
                    />
                    <input
                      value={albumName}
                      onChange={(event) => setAlbumName(event.target.value)}
                      placeholder={t.music.albumNamePlaceholder}
                      className="music-field"
                    />
                    <input
                      value={albumArtistName}
                      onChange={(event) => setAlbumArtistName(event.target.value)}
                      placeholder={t.music.albumArtistPlaceholder}
                      className="music-field"
                    />
                    <input
                      value={genres}
                      onChange={(event) => setGenres(event.target.value)}
                      placeholder={t.music.genresPlaceholder}
                      className="music-field"
                    />
                    <input
                      value={year}
                      onChange={(event) => setYear(event.target.value)}
                      type="number"
                      placeholder={t.music.year}
                      className="music-field"
                    />
                    <button
                      type="button"
                      disabled={!selected.size || bulk.isPending}
                      onClick={() =>
                        bulk.mutate(
                          {
                            trackIds: [...selected],
                            artist: artistName.trim() || undefined,
                            album: albumName.trim() || undefined,
                            albumArtist: albumArtistName.trim() || undefined,
                            genres: genres.trim()
                              ? genres
                                  .split(',')
                                  .map((item) => item.trim())
                                  .filter(Boolean)
                              : undefined,
                            year: year ? Number(year) : undefined,
                            metadataLocked: true,
                          },
                          {
                            onSuccess: (result) => {
                              toast.success(t.music.bulkMetadataUpdated(result.updated));
                              setSelected(new Set());
                            },
                            onError: (error) => toast.fromError(error),
                          },
                        )
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                    >
                      <Save className="h-4 w-4" /> {t.common.save}
                    </button>
                  </div>
                  <div className="mt-5 max-h-[520px] divide-y divide-zinc-800/60 overflow-y-auto rounded-lg border border-zinc-800/70 bg-zinc-950/40">
                    {entityTracks.map((track) => (
                      <label
                        key={track.id}
                        className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-zinc-900/50"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(track.id)}
                          onChange={() => toggleTrack(track.id)}
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {track.title}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {track.issues
                              .map(
                                (issue) =>
                                  t.music.metadataIssues[
                                    issue as keyof typeof t.music.metadataIssues
                                  ] || issue,
                              )
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="text-xs font-black text-amber-200">
                          {track.confidence}%
                        </span>
                      </label>
                    ))}
                  </div>
                </Panel>

                <div className="space-y-6">
                  <Panel className="p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-[15px] font-semibold">
                        {t.music.pendingReview}
                      </h2>
                      <span className="text-xs font-medium text-zinc-500">
                        {metadataSuggestions.length}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {metadataSuggestions.slice(0, 8).map((suggestion) => (
                        <SuggestionCard
                          key={suggestion.id}
                          suggestion={suggestion}
                          title={
                            trackById.get(suggestion.targetId)?.title || t.music.missingMetadata
                          }
                          busy={resolveSuggestion.isPending}
                          onResolve={(accept) => resolve(suggestion, accept)}
                        />
                      ))}
                      {!metadataSuggestions.length && (
                        <EmptyState
                          icon={CheckCircle2}
                          title={t.music.noSuggestions}
                          detail={t.music.noSuggestionsHint}
                        />
                      )}
                    </div>
                  </Panel>

                  <Panel className="p-5">
                    <h2 className="font-display text-[15px] font-semibold">
                      {t.music.albumBatchEditor}
                    </h2>
                    <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                      {albums.map((album) => (
                        <form
                          key={album.id}
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            editAlbum.mutate(
                              { id: album.id, title: String(form.get('title') || album.title) },
                              {
                                onSuccess: () => toast.success(t.music.albumUpdated),
                                onError: (error) => toast.fromError(error),
                              },
                            );
                          }}
                        >
                          <input name="title" defaultValue={album.title} className="music-field" />
                          <button
                            type="submit"
                            aria-label={t.common.save}
                            className="rounded-lg border border-zinc-700 px-3 text-zinc-400 hover:bg-zinc-800/60"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </form>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <Panel className="p-5" accent="cyan">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="inline-flex rounded-lg bg-zinc-900 p-2 text-zinc-500">
                        <Gauge className="h-4 w-4" />
                      </span>
                      <h2 className="mt-3 font-display text-[15px] font-semibold">
                        {t.music.replayGainScan}
                      </h2>
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                        {t.music.replayGainScanHint}
                      </p>
                    </div>
                    <span className="text-xl font-semibold text-zinc-600">
                      {data.replayGainMissing.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      replayGain.mutate(
                        data.replayGainMissing.slice(0, 8).map((track) => track.id),
                        {
                          onSuccess: (result) =>
                            toast.success(
                              t.music.replayGainResult(
                                result.updated.length,
                                result.skipped.length,
                              ),
                            ),
                          onError: (error) => toast.fromError(error),
                        },
                      )
                    }
                    disabled={!data.replayGainMissing.length || replayGain.isPending}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                  >
                    {replayGain.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {replayGain.isPending ? t.music.scanning : t.music.scanFirstTracks}
                  </button>
                  <div className="mt-5">
                    <MusicTrackList tracks={data.replayGainMissing.slice(0, 5)} />
                  </div>
                </Panel>

                <Panel className="p-5" accent="violet">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="inline-flex rounded-lg bg-zinc-900 p-2 text-zinc-500">
                        <AudioWaveform className="h-4 w-4" />
                      </span>
                      <h2 className="mt-3 font-display text-[15px] font-semibold">
                        {t.music.acousticFingerprint}
                      </h2>
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                        {t.music.acousticFingerprintHint}
                      </p>
                    </div>
                    <span className="text-right text-xs font-medium text-zinc-500">
                      {t.music.fingerprintsAnalyzed(
                        data.fingerprints.analyzed,
                        data.fingerprints.identified,
                      )}
                    </span>
                  </div>
                  {!data.fingerprints.available && (
                    <p className="mt-4 rounded-xl bg-amber-300/10 p-3 text-xs text-amber-200">
                      {t.music.fpcalcUnavailable}
                    </p>
                  )}
                  {data.fingerprints.available && !data.fingerprints.acoustidConfigured && (
                    <p className="mt-4 rounded-xl bg-amber-300/10 p-3 text-xs text-amber-100/70">
                      {t.music.acoustidNotConfigured}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      fingerprints.mutate(
                        {
                          trackIds: data.fingerprintCandidates
                            .slice(0, 20)
                            .map((track) => track.id),
                        },
                        {
                          onSuccess: (result) =>
                            toast.success(
                              t.music.fingerprintsAnalyzed(
                                result.analyzed.length,
                                result.identified.length,
                              ),
                            ),
                          onError: (error) => toast.fromError(error),
                        },
                      )
                    }
                    disabled={
                      !data.fingerprints.available ||
                      !data.fingerprintCandidates.length ||
                      fingerprints.isPending
                    }
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                  >
                    {fingerprints.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    {fingerprints.isPending ? t.music.scanning : t.music.scanFingerprints}
                  </button>
                </Panel>
              </div>

              <Panel className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-[15px] font-semibold">
                      {t.music.duplicateTracks}
                    </h2>
                    <p className="mt-1 text-[13px] text-zinc-500">{t.music.duplicateHint}</p>
                  </div>
                  <span className="text-xs font-medium text-zinc-500">
                    {data.duplicates.length + data.acousticDuplicates.length}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  {[...data.acousticDuplicates, ...data.duplicates].map((group) => (
                    <details
                      key={group.key}
                      className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-4"
                    >
                      <summary className="cursor-pointer text-sm font-bold">
                        {group.tracks[0]?.title} · {group.tracks.length}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {group.tracks.map((track) => (
                          <div
                            key={track.id}
                            className="flex items-center gap-2 rounded-lg border-t border-zinc-800/60 p-2 text-xs text-zinc-500 first:border-t-0"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {track.source?.fileName || track.title}
                            </span>
                            {track.id === group.recommendedTrackId ? (
                              <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[9px] font-black text-emerald-200">
                                {t.music.recommendedQuality}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  group.recommendedTrackId &&
                                  archiveDuplicate.mutate(
                                    {
                                      keepTrackId: group.recommendedTrackId,
                                      archiveTrackId: track.id,
                                      replacePlaylistItems: true,
                                    },
                                    {
                                      onSuccess: () => toast.success(t.music.duplicateArchived),
                                      onError: (error) => toast.fromError(error),
                                    },
                                  )
                                }
                                className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-400 hover:bg-zinc-800/60"
                              >
                                {t.music.archiveLowerQuality}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
                {!data.duplicates.length && !data.acousticDuplicates.length && (
                  <div className="mt-5">
                    <EmptyState
                      icon={CheckCircle2}
                      title={t.music.noDuplicates}
                      detail={t.music.noDuplicatesHint}
                    />
                  </div>
                )}
              </Panel>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
              <Panel className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-[15px] font-semibold">
                      {t.music.pendingReview}
                    </h2>
                    <p className="mt-1 text-[13px] text-zinc-500">{t.music.pendingReviewHint}</p>
                  </div>
                  <span className="text-xs font-medium text-zinc-500">{suggestions.length}</span>
                </div>
                <div className="mt-5 space-y-3">
                  {suggestions.map((suggestion) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      title={
                        artistById.get(suggestion.targetId)?.name ||
                        trackById.get(suggestion.targetId)?.title ||
                        suggestion.provider
                      }
                      busy={resolveSuggestion.isPending}
                      onResolve={(accept) => resolve(suggestion, accept)}
                    />
                  ))}
                  {!suggestions.length && (
                    <EmptyState
                      icon={CheckCircle2}
                      title={t.music.noSuggestions}
                      detail={t.music.noSuggestionsHint}
                    />
                  )}
                </div>
              </Panel>

              <Panel className="p-5">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-zinc-900 p-2 text-zinc-500">
                    <History className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-[15px] font-semibold">
                      {t.music.actionHistory}
                    </h2>
                    <p className="mt-1 text-[13px] text-zinc-500">{t.music.actionHistoryHint}</p>
                  </div>
                </div>
                <div className="mt-5 divide-y divide-zinc-800/60">
                  {data.actions?.map((action) => (
                    <div key={action.id} className="flex items-center gap-3 py-3.5">
                      <span className="rounded-lg bg-zinc-900 p-2 text-zinc-500">
                        <Activity className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {t.music.maintenanceActions[
                            action.actionType as keyof typeof t.music.maintenanceActions
                          ] || action.actionType}
                        </p>
                        <p className="mt-0.5 text-[10px] text-zinc-600">
                          {new Date(action.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!!action.revertedAt || undo.isPending}
                        onClick={() =>
                          undo.mutate(action.id, {
                            onSuccess: () => toast.success(t.music.actionUndone),
                            onError: (error) => toast.fromError(error),
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-25"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> {t.music.undoAction}
                      </button>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

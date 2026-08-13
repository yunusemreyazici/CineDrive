import type { MusicMaintenanceDto, MusicMaintenanceSuggestionDto } from '@cinedrive/shared';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
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
> = ({ children, className = '', accent }) => {
  const accentClass =
    accent === 'cyan'
      ? 'border-cyan-300/15 bg-gradient-to-br from-cyan-950/25 via-white/[.025] to-transparent'
      : accent === 'violet'
        ? 'border-violet-300/15 bg-gradient-to-br from-violet-950/25 via-white/[.025] to-transparent'
        : accent === 'amber'
          ? 'border-amber-300/15 bg-gradient-to-br from-amber-950/20 via-white/[.025] to-transparent'
          : 'border-white/[.07] bg-white/[.025]';
  return (
    <section className={`rounded-[28px] border ${accentClass} ${className}`}>{children}</section>
  );
};

const EmptyState: React.FC<{
  icon: React.ElementType;
  title: string;
  detail: string;
}> = ({ icon: Icon, title, detail }) => (
  <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 px-6 text-center">
    <Icon className="h-7 w-7 text-white/20" />
    <p className="mt-3 text-sm font-bold text-white/70">{title}</p>
    <p className="mt-1 max-w-sm text-xs leading-5 text-white/35">{detail}</p>
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
    <article className="overflow-hidden rounded-2xl border border-white/[.08] bg-black/25 p-4">
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
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-black text-black disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" /> {t.music.acceptSuggestion}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(false)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-white/55 disabled:opacity-40"
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

  const metricCards = [
    {
      tab: 'artwork' as const,
      icon: UserRound,
      label: t.music.missingArtistArtwork,
      value: data.totals.missingArtistArtwork,
      tone: 'text-cyan-200 bg-cyan-300/10',
    },
    {
      tab: 'metadata' as const,
      icon: AlertTriangle,
      label: t.music.missingMetadata,
      value: data.totals.missingMetadata,
      tone: 'text-amber-200 bg-amber-300/10',
    },
    {
      tab: 'audio' as const,
      icon: Layers3,
      label: t.music.duplicateTracks,
      value: data.totals.duplicates,
      tone: 'text-violet-200 bg-violet-300/10',
    },
    {
      tab: 'audio' as const,
      icon: Gauge,
      label: t.music.replayGainMissing,
      value: data.totals.replayGainMissing,
      tone: 'text-emerald-200 bg-emerald-300/10',
    },
  ];

  return (
    <div className="space-y-6 pb-32">
      <header className="relative isolate overflow-hidden rounded-[36px] border border-white/[.09] bg-[#0b0d12] px-6 py-7 sm:px-8 lg:px-10 lg:py-9">
        <div className="absolute -right-24 -top-32 -z-10 h-96 w-96 rounded-full bg-cyan-400/15 blur-[110px]" />
        <div className="absolute -bottom-36 left-1/3 -z-10 h-80 w-80 rounded-full bg-violet-500/10 blur-[100px]" />
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <p className="text-[11px] font-black uppercase tracking-[.26em] text-cyan-300">
              CineDrive Music · {t.music.maintenanceControlCenter}
            </p>
            <h1 className="mt-3 font-display text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
              {t.music.libraryCare}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/45">
              {t.music.maintenanceDescriptionNew}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/[.05] px-3 py-1.5 text-xs font-bold text-white/60">
                {t.music.maintenanceIssueCount(totalIssues)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[.05] px-3 py-1.5 text-xs font-bold text-white/60">
                {t.music.artistArtworkCoverage(artworkCount, artists.length)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[.05] px-3 py-1.5 text-xs font-bold text-white/60">
                {t.music.pendingSuggestionCount(suggestions.length)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={smartScan}
            disabled={generate.isPending}
            className="inline-flex min-w-52 items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-black text-black shadow-[0_16px_45px_rgba(255,255,255,.12)] transition hover:scale-[1.02] disabled:opacity-50"
          >
            {generate.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generate.isPending ? t.music.scanning : t.music.smartScan}
          </button>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-white/[.07] bg-black/25 p-1.5">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            type="button"
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
              activeTab === id
                ? 'bg-white text-black shadow-lg'
                : 'text-white/45 hover:bg-white/[.05] hover:text-white/75'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {!!count && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === id ? 'bg-black/10' : 'bg-white/10'}`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metricCards.map(({ tab, icon: Icon, label, value, tone }) => (
              <button
                type="button"
                key={label}
                onClick={() => setActiveTab(tab)}
                className="group rounded-[24px] border border-white/[.07] bg-white/[.025] p-5 text-left transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[.045]"
              >
                <div className="flex items-start justify-between">
                  <span className={`rounded-xl p-2.5 ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-white/15 transition group-hover:translate-x-0.5 group-hover:text-white/50" />
                </div>
                <p className="mt-7 text-3xl font-black">{value}</p>
                <p className="mt-1 text-xs font-semibold text-white/40">{label}</p>
              </button>
            ))}
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
            <Panel className="p-5 md:p-7" accent="cyan">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">
                    {t.music.recommendedNextStep}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold">
                    {t.music.completeArtistArtwork}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/40">
                    {t.music.completeArtistArtworkHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => scanArtwork()}
                  disabled={artworkScan.isPending || !data.totals.missingArtistArtwork}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-2.5 text-xs font-black text-black disabled:opacity-40"
                >
                  {artworkScan.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {artworkScan.isPending ? t.music.scanning : t.music.scanNextArtists}
                </button>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-black/20 p-4">
                  <p className="text-2xl font-black text-emerald-200">{artworkCount}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
                    {t.music.artworkReady}
                  </p>
                </div>
                <div className="rounded-2xl bg-black/20 p-4">
                  <p className="text-2xl font-black text-amber-200">
                    {artists.filter((artist) => artist.artworkLookupStatus === 'not-found').length}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
                    {t.music.sourceUnavailable}
                  </p>
                </div>
                <div className="rounded-2xl bg-black/20 p-4">
                  <p className="text-2xl font-black text-cyan-200">
                    {
                      artists.filter((artist) => !artist.artworkLookupAt && !artist.artworkUrl)
                        .length
                    }
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/30">
                    {t.music.waitingForScan}
                  </p>
                </div>
              </div>
            </Panel>

            <Panel className="p-5 md:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl font-bold">{t.music.pendingReview}</h2>
                  <p className="mt-1 text-xs text-white/35">{t.music.pendingReviewHint}</p>
                </div>
                <span className="rounded-full bg-white/[.07] px-3 py-1 text-xs font-black">
                  {suggestions.length}
                </span>
              </div>
              <div className="mt-5 space-y-2">
                {suggestions.slice(0, 4).map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.id}
                    onClick={() =>
                      setActiveTab(suggestion.kind === 'artwork' ? 'artwork' : 'metadata')
                    }
                    className="flex w-full items-center gap-3 rounded-xl bg-white/[.035] p-3 text-left hover:bg-white/[.06]"
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
                      <span className="mt-0.5 block text-[10px] text-white/30">
                        {suggestion.provider} · {suggestion.confidence}%
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-white/20" />
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
          <Panel className="p-5 md:p-7" accent="cyan">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
              <div>
                <div className="flex items-center gap-3">
                  <span className="rounded-2xl bg-cyan-300/10 p-3 text-cyan-200">
                    <ImageIcon className="h-6 w-6" />
                  </span>
                  <div>
                    <h2 className="font-display text-2xl font-bold">
                      {t.music.artistArtworkStudio}
                    </h2>
                    <p className="mt-1 text-sm text-white/40">{t.music.artistArtworkStudioHint}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl bg-black/20 px-5 py-3">
                  <p className="text-2xl font-black">
                    {artworkCount}
                    <span className="text-base text-white/25">/{artists.length}</span>
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/30">
                    {t.music.artworkCoverage}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => scanArtwork()}
                  disabled={artworkScan.isPending || !data.totals.missingArtistArtwork}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-xs font-black text-black disabled:opacity-40"
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
              <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-white/[.07] bg-black/20 p-4 text-xs font-bold">
                <span className="text-white/45">
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
            <Panel className="p-5 md:p-7">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-xl font-bold">
                    {t.music.previouslyFoundArtwork}
                  </h2>
                  <p className="mt-1 text-xs text-white/35">{t.music.previouslyFoundArtworkHint}</p>
                </div>
                <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-200">
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

          <Panel className="p-5 md:p-7">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.music.artistLibrary}</h2>
                <p className="mt-1 text-sm text-white/35">{t.music.artistLibraryHint}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex min-w-52 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white/45 focus-within:border-cyan-300/30">
                  <Search className="h-4 w-4" />
                  <input
                    value={artistQuery}
                    onChange={(event) => setArtistQuery(event.target.value)}
                    placeholder={t.music.searchArtists}
                    className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/25"
                  />
                </label>
                <div className="flex rounded-xl border border-white/10 bg-black/20 p-1">
                  {(['missing', 'all'] as const).map((scope) => (
                    <button
                      type="button"
                      key={scope}
                      onClick={() => setArtistScope(scope)}
                      className={`rounded-lg px-3 py-1.5 text-[10px] font-black ${
                        artistScope === scope ? 'bg-white text-black' : 'text-white/40'
                      }`}
                    >
                      {scope === 'missing' ? t.music.missingOnly : t.music.allArtists}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {filteredArtists.map((artist) => {
                const status = artist.artworkUrl
                  ? 'found'
                  : artist.artworkLookupStatus || 'pending';
                return (
                  <article
                    key={artist.id}
                    className="group rounded-2xl border border-white/[.07] bg-black/20 p-3 transition hover:border-white/15 hover:bg-white/[.035]"
                  >
                    <div className="flex gap-3">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/[.08]">
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
                            className="rounded-lg p-1.5 text-white/25 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100 focus:opacity-100"
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
                        <p className="mt-2 truncate text-[10px] text-white/25">
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
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-300/15 bg-cyan-300/[.06] px-3 py-2 text-[10px] font-black text-cyan-200 disabled:opacity-40"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> {t.music.findArtistArtwork}
                        </button>
                      )}
                      <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[10px] font-bold text-white/50 hover:bg-white/[.05]">
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
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[10px] font-bold text-white/40 hover:bg-rose-500/10 hover:text-rose-200"
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
            <Panel className="p-5 md:p-7" accent="amber">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-bold">{t.music.metadataWorkspace}</h2>
                  <p className="mt-1 text-sm text-white/40">{t.music.bulkMetadataHint}</p>
                </div>
                <span className="rounded-full bg-white/[.07] px-3 py-1.5 text-xs font-black">
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
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-40"
                >
                  <Save className="h-4 w-4" /> {t.common.save}
                </button>
              </div>
              <div className="mt-5 max-h-[520px] divide-y divide-white/[.06] overflow-y-auto rounded-2xl border border-white/[.07] bg-black/15">
                {entityTracks.map((track) => (
                  <label
                    key={track.id}
                    className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[.04]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(track.id)}
                      onChange={() => toggleTrack(track.id)}
                      className="h-4 w-4 accent-cyan-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{track.title}</span>
                      <span className="block truncate text-xs text-white/35">
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
                    <span className="text-xs font-black text-amber-200">{track.confidence}%</span>
                  </label>
                ))}
              </div>
            </Panel>

            <div className="space-y-6">
              <Panel className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold">{t.music.pendingReview}</h2>
                  <span className="rounded-full bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">
                    {metadataSuggestions.length}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {metadataSuggestions.slice(0, 8).map((suggestion) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      title={trackById.get(suggestion.targetId)?.title || t.music.missingMetadata}
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
                <h2 className="font-display text-xl font-bold">{t.music.albumBatchEditor}</h2>
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
                        className="rounded-xl border border-white/10 px-3 hover:bg-white/10"
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
            <Panel className="p-5 md:p-7" accent="cyan">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex rounded-xl bg-cyan-300/10 p-2.5 text-cyan-200">
                    <Gauge className="h-5 w-5" />
                  </span>
                  <h2 className="mt-5 font-display text-2xl font-bold">{t.music.replayGainScan}</h2>
                  <p className="mt-2 text-sm leading-6 text-white/40">
                    {t.music.replayGainScanHint}
                  </p>
                </div>
                <span className="text-3xl font-black text-white/20">
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
                          t.music.replayGainResult(result.updated.length, result.skipped.length),
                        ),
                      onError: (error) => toast.fromError(error),
                    },
                  )
                }
                disabled={!data.replayGainMissing.length || replayGain.isPending}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-2.5 text-xs font-black text-black disabled:opacity-40"
              >
                {replayGain.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {replayGain.isPending ? t.music.scanning : t.music.scanFirstTracks}
              </button>
              <div className="mt-5">
                <MusicTrackList tracks={data.replayGainMissing.slice(0, 5)} />
              </div>
            </Panel>

            <Panel className="p-5 md:p-7" accent="violet">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex rounded-xl bg-violet-300/10 p-2.5 text-violet-200">
                    <AudioWaveform className="h-5 w-5" />
                  </span>
                  <h2 className="mt-5 font-display text-2xl font-bold">
                    {t.music.acousticFingerprint}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-white/40">
                    {t.music.acousticFingerprintHint}
                  </p>
                </div>
                <span className="text-right text-xs font-bold text-white/30">
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
                      trackIds: data.fingerprintCandidates.slice(0, 20).map((track) => track.id),
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
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-violet-300 px-5 py-2.5 text-xs font-black text-black disabled:opacity-40"
              >
                {fingerprints.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {fingerprints.isPending ? t.music.scanning : t.music.scanFingerprints}
              </button>
            </Panel>
          </div>

          <Panel className="p-5 md:p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.music.duplicateTracks}</h2>
                <p className="mt-1 text-sm text-white/35">{t.music.duplicateHint}</p>
              </div>
              <span className="rounded-full bg-violet-300/10 px-3 py-1.5 text-xs font-black text-violet-200">
                {data.duplicates.length + data.acousticDuplicates.length}
              </span>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {[...data.acousticDuplicates, ...data.duplicates].map((group) => (
                <details
                  key={group.key}
                  className="rounded-2xl border border-white/[.07] bg-black/20 p-4"
                >
                  <summary className="cursor-pointer text-sm font-bold">
                    {group.tracks[0]?.title} · {group.tracks.length}
                  </summary>
                  <div className="mt-3 space-y-2">
                    {group.tracks.map((track) => (
                      <div
                        key={track.id}
                        className="flex items-center gap-2 rounded-xl bg-white/[.035] p-2 text-xs text-white/45"
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
                            className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-bold hover:bg-white/10"
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
          <Panel className="p-5 md:p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold">{t.music.pendingReview}</h2>
                <p className="mt-1 text-sm text-white/35">{t.music.pendingReviewHint}</p>
              </div>
              <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-200">
                {suggestions.length}
              </span>
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

          <Panel className="p-5 md:p-7">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-white/[.06] p-2.5 text-white/50">
                <History className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-2xl font-bold">{t.music.actionHistory}</h2>
                <p className="mt-1 text-sm text-white/35">{t.music.actionHistoryHint}</p>
              </div>
            </div>
            <div className="mt-5 divide-y divide-white/[.06]">
              {data.actions?.map((action) => (
                <div key={action.id} className="flex items-center gap-3 py-3.5">
                  <span className="rounded-xl bg-white/[.04] p-2 text-white/35">
                    <Activity className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {t.music.maintenanceActions[
                        action.actionType as keyof typeof t.music.maintenanceActions
                      ] || action.actionType}
                    </p>
                    <p className="mt-0.5 text-[10px] text-white/30">
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
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-[10px] font-bold text-white/50 disabled:opacity-25"
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
  );
};

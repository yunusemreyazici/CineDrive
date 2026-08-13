import type { MusicMaintenanceDto, MusicMaintenanceSuggestionDto } from '@cinedrive/shared';
import {
  Activity,
  ArrowRight,
  AudioWaveform,
  Check,
  CheckCircle2,
  ChevronLeft,
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

const Panel: React.FC<React.PropsWithChildren<{ className?: string }>> = ({
  children,
  className = '',
}) => (
  <section className={`min-w-0 rounded-xl border border-zinc-800/70 bg-zinc-950/45 ${className}`}>
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
      <p className="mt-1 text-xs leading-4 text-zinc-500">{label}</p>
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

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const formatGenres = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value !== 'string') return t.music.suggestionEmpty;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.length
      ? parsed.map(String).join(', ')
      : t.music.suggestionEmpty;
  } catch {
    return value || t.music.suggestionEmpty;
  }
};

const formatCredits = (value: unknown) => {
  if (!Array.isArray(value) || !value.length) return t.music.suggestionEmpty;
  const names = value.map((item) => String(asRecord(item).name || '')).filter(Boolean);
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} ${t.music.suggestionMore(names.length - 3)}`;
};

const providerLabel = (provider: string) =>
  ({
    musicbrainz: 'MusicBrainz',
    acoustid: 'AcoustID',
    'cover-art-archive': 'Cover Art Archive',
    'wikimedia-commons': 'Wikimedia Commons',
    deezer: 'Deezer',
  })[provider] || provider;

type VisibleChange = { label: string; before: string; after: string };

const suggestionChanges = (suggestion: MusicMaintenanceSuggestionDto): VisibleChange[] => {
  const current = asRecord(suggestion.currentData);
  const proposed = asRecord(suggestion.proposedData);
  if (suggestion.kind === 'artwork')
    return [
      {
        label: t.music.suggestionFields.artwork,
        before: t.music.suggestionArtworkMissing,
        after: t.music.suggestionArtworkReady,
      },
    ];

  const changes: VisibleChange[] = [];
  const add = (
    label: string,
    key: string,
    formatter: (value: unknown) => string = (value) =>
      String(value ?? '') || t.music.suggestionEmpty,
  ) => {
    const before = formatter(current[key]);
    const after = formatter(proposed[key]);
    if (before !== after) changes.push({ label, before, after });
  };

  if (suggestion.kind === 'acoustic-metadata') {
    add(t.music.suggestionFields.title, 'title');
    add(t.music.suggestionFields.artist, 'artist');
  }
  add(t.music.suggestionFields.year, 'year');
  add(t.music.suggestionFields.genres, 'genres', formatGenres);
  add(t.music.suggestionFields.credits, 'credits', formatCredits);

  const currentRecording = Boolean(current.musicbrainzRecordingId);
  const proposedRecording = Boolean(proposed.musicbrainzRecordingId);
  if (currentRecording !== proposedRecording)
    changes.push({
      label: t.music.suggestionFields.recordingMatch,
      before: currentRecording ? t.music.suggestionMatchFound : t.music.suggestionMatchMissing,
      after: proposedRecording ? t.music.suggestionMatchFound : t.music.suggestionMatchMissing,
    });

  const currentRelease = Boolean(current.musicbrainzReleaseId || current.musicbrainzReleaseGroupId);
  const proposedRelease = Boolean(
    proposed.musicbrainzReleaseId || proposed.musicbrainzReleaseGroupId,
  );
  if (currentRelease !== proposedRelease)
    changes.push({
      label: t.music.suggestionFields.albumMatch,
      before: currentRelease ? t.music.suggestionMatchFound : t.music.suggestionMatchMissing,
      after: proposedRelease ? t.music.suggestionMatchFound : t.music.suggestionMatchMissing,
    });

  return changes;
};

const SuggestionCard: React.FC<{
  suggestion: MusicMaintenanceSuggestionDto;
  busy: boolean;
  onResolve: (accept: boolean) => void;
}> = ({ suggestion, busy, onResolve }) => {
  const proposed = asRecord(suggestion.proposedData);
  const preview = typeof proposed.previewUrl === 'string' ? proposed.previewUrl : undefined;
  const artwork = preview || suggestion.target?.artworkUrl || undefined;
  const changes = suggestionChanges(suggestion);
  const kindLabel =
    t.music.suggestionKinds[suggestion.kind as keyof typeof t.music.suggestionKinds] ||
    t.music.suggestionKinds.metadata;
  return (
    <article className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/50 p-4 sm:p-5">
      <div className="flex items-start gap-4">
        {artwork ? (
          <img src={artwork} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white/5">
            <WandSparkles className="h-5 w-5 text-zinc-500" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold">
            <span className="uppercase tracking-[.14em] text-brand-300">{kindLabel}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-500">{providerLabel(suggestion.provider)}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-500">
              {t.music.suggestionConfidence(suggestion.confidence)}
            </span>
          </div>
          <h3 className="mt-2 truncate text-sm font-semibold text-zinc-100">
            {suggestion.target?.title || t.music.suggestionUnknownTarget}
          </h3>
          {suggestion.target?.subtitle && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{suggestion.target.subtitle}</p>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800/70">
        {changes.map((change) => (
          <div
            key={`${change.label}-${change.after}`}
            className="grid gap-1 border-t border-zinc-800/60 px-3 py-2.5 first:border-t-0 sm:grid-cols-[110px_minmax(0,1fr)] sm:items-center sm:gap-3"
          >
            <span className="text-[11px] font-medium text-zinc-500">{change.label}</span>
            <div className="flex min-w-0 items-start gap-2 text-xs leading-relaxed">
              <span className="min-w-0 break-words text-zinc-600">{change.before}</span>
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-700" />
              <span className="min-w-0 break-words font-medium text-zinc-200">{change.after}</span>
            </div>
          </div>
        ))}
        {!changes.length && (
          <p className="px-3 py-3 text-xs leading-relaxed text-zinc-500">
            {t.music.suggestionNoVisibleChanges}
          </p>
        )}
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
  const [metadataPage, setMetadataPage] = useState(0);
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
  const duplicateGroups = useMemo(() => {
    const unique = new Map<string, MusicMaintenanceDto['duplicates'][number]>();
    for (const group of [...(data?.acousticDuplicates || []), ...(data?.duplicates || [])]) {
      const signature = group.tracks
        .map((track) => track.id)
        .sort()
        .join(':');
      if (!unique.has(signature)) unique.set(signature, group);
    }
    return [...unique.values()];
  }, [data?.acousticDuplicates, data?.duplicates]);
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

  const artworkCount = artists.filter((artist) => !!artist.artworkUrl).length;
  const hasBulkChanges = Boolean(
    artistName.trim() || albumName.trim() || albumArtistName.trim() || genres.trim() || year,
  );
  const metadataPageSize = 50;
  const metadataPageCount = Math.max(1, Math.ceil(entityTracks.length / metadataPageSize));
  const visibleMetadataTracks = entityTracks.slice(
    metadataPage * metadataPageSize,
    (metadataPage + 1) * metadataPageSize,
  );
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

  const nextStep = suggestions.length
    ? {
        title: t.music.reviewPendingChanges,
        detail: t.music.reviewPendingChangesHint(suggestions.length),
        label: t.music.openReviewQueue,
        icon: History,
        action: () => setActiveTab('activity' as const),
        pending: false,
      }
    : data.totals.missingArtistArtwork
      ? {
          title: t.music.completeArtistArtwork,
          detail: t.music.completeArtistArtworkHint,
          label: t.music.scanNextArtists,
          icon: RefreshCw,
          action: () => scanArtwork(),
          pending: artworkScan.isPending,
        }
      : data.totals.missingMetadata
        ? {
            title: t.music.reviewMetadataIssues,
            detail: t.music.reviewMetadataIssuesHint(data.totals.missingMetadata),
            label: t.music.openMetadataWorkspace,
            icon: ListMusic,
            action: () => setActiveTab('metadata' as const),
            pending: false,
          }
        : data.totals.duplicates + data.totals.replayGainMissing
          ? {
              title: t.music.reviewAudioIssues,
              detail: t.music.reviewAudioIssuesHint(
                data.totals.duplicates + data.totals.replayGainMissing,
              ),
              label: t.music.openAudioWorkspace,
              icon: AudioWaveform,
              action: () => setActiveTab('audio' as const),
              pending: false,
            }
          : null;

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

          <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
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

        <nav
          aria-label={t.music.maintenanceSections}
          className="scrollbar-none flex gap-1 overflow-x-auto border-y border-zinc-800/70 bg-zinc-950/60 p-2"
        >
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
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
              <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,.75fr)]">
                <Panel className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                        {t.music.recommendedNextStep}
                      </p>
                      <h2 className="mt-2 font-display text-[15px] font-semibold text-white">
                        {nextStep?.title || t.music.libraryHealthy}
                      </h2>
                      <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-zinc-500">
                        {nextStep?.detail || t.music.libraryHealthyHint}
                      </p>
                    </div>
                    {nextStep ? (
                      <button
                        type="button"
                        onClick={nextStep.action}
                        disabled={nextStep.pending}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                      >
                        {nextStep.pending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <nextStep.icon className="h-4 w-4" />
                        )}
                        {nextStep.pending ? t.music.scanning : nextStep.label}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" /> {t.music.upToDate}
                      </span>
                    )}
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
                            {suggestion.target?.title ||
                              artistById.get(suggestion.targetId)?.name ||
                              trackById.get(suggestion.targetId)?.title ||
                              t.music.suggestionUnknownTarget}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-zinc-600">
                            {providerLabel(suggestion.provider)} ·{' '}
                            {t.music.suggestionConfidence(suggestion.confidence)}
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
              <Panel className="p-5">
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
                    {data.totals.missingArtistArtwork ? (
                      <button
                        type="button"
                        onClick={() => scanArtwork()}
                        disabled={artworkScan.isPending}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
                      >
                        {artworkScan.isPending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {artworkScan.isPending ? t.music.scanning : t.music.scanNextArtists}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" /> {t.music.allArtistArtworkReady}
                      </span>
                    )}
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
                        aria-label={t.music.searchArtists}
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
                                aria-label={t.music.editArtistName(artist.name)}
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
              <div className="space-y-6">
                <Panel className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-[15px] font-semibold">
                        {t.music.metadataWorkspace}
                      </h2>
                      <p className="mt-1 text-[13px] text-zinc-500">{t.music.bulkMetadataHint}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-live="polite" className="text-xs font-medium text-zinc-500">
                        {t.music.selectedCount(selected.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const track of visibleMetadataTracks) next.add(track.id);
                            return next;
                          })
                        }
                        disabled={
                          !visibleMetadataTracks.length ||
                          visibleMetadataTracks.every((track) => selected.has(track.id))
                        }
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
                      >
                        {t.music.selectListedTracks}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        disabled={!selected.size}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
                      >
                        {t.music.clearTrackSelection}
                      </button>
                    </div>
                  </div>
                  <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="min-w-0">
                      <span className="music-field-label">{t.music.artist}</span>
                      <input
                        value={artistName}
                        onChange={(event) => setArtistName(event.target.value)}
                        placeholder={t.music.leaveUnchanged}
                        className="music-field"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="music-field-label">{t.music.album}</span>
                      <input
                        value={albumName}
                        onChange={(event) => setAlbumName(event.target.value)}
                        placeholder={t.music.leaveUnchanged}
                        className="music-field"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="music-field-label">{t.music.albumArtistField}</span>
                      <input
                        value={albumArtistName}
                        onChange={(event) => setAlbumArtistName(event.target.value)}
                        placeholder={t.music.leaveUnchanged}
                        className="music-field"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="music-field-label">{t.music.genres}</span>
                      <input
                        value={genres}
                        onChange={(event) => setGenres(event.target.value)}
                        placeholder={t.music.genresPlaceholder}
                        className="music-field"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="music-field-label">{t.music.year}</span>
                      <input
                        value={year}
                        onChange={(event) => setYear(event.target.value)}
                        type="number"
                        min={1800}
                        max={new Date().getFullYear() + 1}
                        placeholder={t.music.leaveUnchanged}
                        className="music-field"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!selected.size || !hasBulkChanges || bulk.isPending}
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
                              setMetadataPage(0);
                              setArtistName('');
                              setAlbumName('');
                              setAlbumArtistName('');
                              setGenres('');
                              setYear('');
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
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-zinc-600">
                    <p>{t.music.bulkSaveHint}</p>
                    <span>{t.music.metadataPage(metadataPage + 1, metadataPageCount)}</span>
                  </div>
                  <div className="mt-5 max-h-[520px] divide-y divide-zinc-800/60 overflow-y-auto rounded-lg border border-zinc-800/70 bg-zinc-950/40">
                    {visibleMetadataTracks.map((track) => (
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
                  {metadataPageCount > 1 && (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        aria-label={t.music.previousMetadataPage}
                        onClick={() => setMetadataPage((page) => Math.max(0, page - 1))}
                        disabled={metadataPage === 0}
                        className="rounded-lg border border-zinc-700 p-2 text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={t.music.nextMetadataPage}
                        onClick={() =>
                          setMetadataPage((page) => Math.min(metadataPageCount - 1, page + 1))
                        }
                        disabled={metadataPage >= metadataPageCount - 1}
                        className="rounded-lg border border-zinc-700 p-2 text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </Panel>

                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-[15px] font-semibold">
                      {t.music.pendingReview}
                    </h2>
                    <span className="text-xs font-medium text-zinc-500">
                      {metadataSuggestions.length}
                    </span>
                  </div>
                  <div className="mt-4 grid min-w-0 gap-3 2xl:grid-cols-2">
                    {metadataSuggestions.slice(0, 8).map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
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
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-6">
              <div className="grid min-w-0 gap-6 2xl:grid-cols-2">
                <Panel className="p-5">
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

                <Panel className="p-5">
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
                    {duplicateGroups.length}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  {duplicateGroups.map((group) => (
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
                                disabled={archiveDuplicate.isPending}
                                onClick={() => {
                                  if (
                                    !group.recommendedTrackId ||
                                    !window.confirm(
                                      t.music.archiveDuplicateConfirm(
                                        track.source?.fileName || track.title,
                                      ),
                                    )
                                  )
                                    return;
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
                                  );
                                }}
                                className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
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
                {!duplicateGroups.length && (
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
            <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
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
                      {action.revertedAt ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[11px] font-medium text-zinc-500">
                          <Check className="h-3.5 w-3.5" /> {t.music.actionReverted}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={undo.isPending}
                          onClick={() =>
                            undo.mutate(action.id, {
                              onSuccess: () => toast.success(t.music.actionUndone),
                              onError: (error) => toast.fromError(error),
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> {t.music.undoAction}
                        </button>
                      )}
                    </div>
                  ))}
                  {!data.actions?.length && (
                    <div className="py-4">
                      <EmptyState
                        icon={History}
                        title={t.music.noMaintenanceActions}
                        detail={t.music.noMaintenanceActionsHint}
                      />
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

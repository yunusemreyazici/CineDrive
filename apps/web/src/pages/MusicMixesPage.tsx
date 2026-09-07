import React from 'react';
import type { MusicMixDto } from '@cinedrive/shared';
import {
  Disc3,
  Infinity as InfinityIcon,
  LoaderCircle,
  Play,
  RadioTower,
  RefreshCw,
  Shuffle,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { MusicMixCard } from '../components/music/MusicMixCard';
import { useMusicPlayer } from '../features/music/MusicPlayerProvider';
import {
  useArtistRadioMutation,
  useMusicAiPlaylistMutation,
  useMusicAiStatusQuery,
  useMusicDiscoveryQuery,
  useSaveMusicMixMutation,
} from '../hooks/useMusicApi';
import { t } from '../i18n';
import { toast } from '../stores/useToastStore';

const SectionTitle: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
}> = ({ eyebrow, title, description }) => (
  <header className="max-w-3xl">
    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-400/80">
      {eyebrow}
    </p>
    <h2 className="mt-1.5 font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
      {title}
    </h2>
    <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 sm:text-sm">{description}</p>
  </header>
);

export const MusicMixesPage: React.FC = () => {
  const generationCounter = React.useRef(0);
  const [generationId, setGenerationId] = React.useState<string>();
  const discovery = useMusicDiscoveryQuery(generationId);
  const saveMix = useSaveMusicMixMutation();
  const artistRadio = useArtistRadioMutation();
  const aiStatus = useMusicAiStatusQuery();
  const aiPlaylist = useMusicAiPlaylistMutation();
  const player = useMusicPlayer();
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [savedIds, setSavedIds] = React.useState<Set<string>>(new Set());
  const [radioArtistId, setRadioArtistId] = React.useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = React.useState('');
  const [lastAiPrompt, setLastAiPrompt] = React.useState('');
  const aiGenerationCounter = React.useRef(0);
  const data = discovery.data;
  const featured = data?.mixes[0];

  const save = (mix: MusicMixDto) => {
    setSavingId(mix.id);
    saveMix.mutate(
      {
        name: mix.title,
        description: `CineDrive Mix · ${mix.subtitle}`,
        trackIds: mix.tracks.map((track) => track.id),
      },
      {
        onSuccess: () => {
          setSavedIds((current) => new Set(current).add(mix.id));
          toast.success(t.music.mixSavedToast(mix.title), t.music.mixSavedHint);
        },
        onError: (error) => toast.fromError(error, t.music.mixSaveFailed),
        onSettled: () => setSavingId(null),
      },
    );
  };

  const startArtistRadio = (artistId: string) => {
    setRadioArtistId(artistId);
    artistRadio.mutate(artistId, {
      onSuccess: (mix) => player.playTracks(mix.tracks),
      onError: (error) => toast.fromError(error, t.music.radioLoadFailed),
      onSettled: () => setRadioArtistId(null),
    });
  };

  const refreshDiscovery = () => {
    generationCounter.current += 1;
    setGenerationId(`web-${Date.now().toString(36)}-${generationCounter.current}`);
  };

  const generateAiPlaylist = (prompt: string) => {
    const normalized = prompt.trim();
    if (normalized.length < 3 || aiPlaylist.isPending) return;
    aiGenerationCounter.current += 1;
    setLastAiPrompt(normalized);
    aiPlaylist.mutate(
      {
        prompt: normalized,
        generationId: `web-ai-${Date.now().toString(36)}-${aiGenerationCounter.current}`,
      },
      {
        onError: (error) => toast.fromError(error, t.music.aiPlaylistUnavailable),
      },
    );
  };

  if (discovery.isLoading) {
    return (
      <div className="space-y-8 pb-32">
        <div className="h-52 animate-pulse rounded-3xl bg-zinc-900" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="aspect-[2.25/1] animate-pulse rounded-xl bg-zinc-900" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (discovery.isError || !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <RadioTower className="h-12 w-12 text-zinc-700" />
        <h1 className="mt-4 font-display text-2xl font-bold">{t.music.mixLoadFailed}</h1>
        <button
          type="button"
          onClick={() => void discovery.refetch()}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black"
        >
          <RefreshCw className="h-4 w-4" /> {t.common.retry}
        </button>
      </div>
    );
  }

  const hasDiscoveryContent =
    data.mixes.length > 0 ||
    data.moodCollections.length > 0 ||
    data.genreCollections.length > 0 ||
    data.decadeCollections.length > 0 ||
    data.radioArtists.length > 0;

  return (
    <div className="space-y-9 pb-32">
      <section className="relative isolate overflow-hidden rounded-[24px] border border-white/[0.09] bg-gradient-to-br from-[#24113a] via-[#10131a] to-[#07191b] px-5 py-7 shadow-[0_28px_80px_rgba(0,0,0,.32)] sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -right-20 -top-32 -z-10 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 left-1/3 -z-10 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="grid items-center gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/70">
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" /> {t.music.personalRadio}
            </span>
            <h1 className="mt-4 max-w-2xl font-display text-3xl font-black leading-[1.02] tracking-[-0.04em] text-white sm:text-5xl">
              {t.music.mixesPageTitle}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55 sm:text-base">
              {t.music.mixesPageDescription}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!featured?.tracks.length}
                onClick={() => featured && player.playTracks(featured.tracks)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:scale-[1.02] disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" /> {t.music.startListening}
              </button>
              <button
                type="button"
                disabled={!featured?.tracks.length}
                onClick={() => featured && player.playShuffledTracks(featured.tracks)}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
              >
                <Shuffle className="h-4 w-4" /> {t.music.shufflePlay}
              </button>
              <button
                type="button"
                disabled={discovery.isFetching}
                onClick={refreshDiscovery}
                aria-label={
                  discovery.isFetching ? t.music.refreshingDiscovery : t.music.refreshDiscovery
                }
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${discovery.isFetching ? 'animate-spin' : ''}`} />
                {discovery.isFetching ? t.music.refreshingDiscovery : t.music.refreshDiscovery}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={player.toggleContinuousPlay}
            aria-pressed={player.continuousPlayEnabled}
            className={`group flex items-center gap-4 rounded-2xl border p-4 text-left transition ${
              player.continuousPlayEnabled
                ? 'border-emerald-300/25 bg-emerald-300/[0.09]'
                : 'border-white/10 bg-black/20 hover:bg-white/[0.06]'
            }`}
          >
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                player.continuousPlayEnabled
                  ? 'bg-emerald-300 text-emerald-950'
                  : 'bg-white/10 text-zinc-400'
              }`}
            >
              <InfinityIcon className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-bold text-white">
                {t.music.continuousPlay}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-white/45">
                {t.music.continuousPlayHint}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                player.continuousPlayEnabled ? 'bg-emerald-300' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-black transition ${
                  player.continuousPlayEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </span>
          </button>
        </div>
      </section>

      {aiStatus.data?.enabled && (
        <section className="overflow-hidden rounded-3xl border border-fuchsia-300/15 bg-gradient-to-br from-fuchsia-950/35 via-[#101116] to-cyan-950/25 p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-300/10 text-fuchsia-200">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="font-display text-lg font-extrabold text-white">
                {t.music.aiPlaylistTitle}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45 sm:text-sm">
                {t.music.aiPlaylistDescription}
              </p>
            </div>
          </div>

          <form
            className="mt-5 flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              generateAiPlaylist(aiPrompt);
            }}
          >
            <label className="sr-only" htmlFor="music-ai-prompt">
              {t.music.aiPlaylistPromptLabel}
            </label>
            <input
              id="music-ai-prompt"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              minLength={3}
              maxLength={1000}
              disabled={aiPlaylist.isPending}
              placeholder={t.music.aiPlaylistPlaceholder}
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-fuchsia-300/40 focus:ring-2 focus:ring-fuchsia-300/10 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={aiPlaylist.isPending || aiPrompt.trim().length < 3}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black transition hover:scale-[1.01] disabled:opacity-45"
            >
              {aiPlaylist.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiPlaylist.isPending ? t.music.aiPlaylistCreating : t.music.aiPlaylistCreate}
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2" aria-label={t.music.aiSuggestedPromptsLabel}>
            {t.music.aiSuggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={aiPlaylist.isPending}
                onClick={() => setAiPrompt(prompt)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-white/55 transition hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>

          {aiPlaylist.data && (
            <div className="mt-6 grid gap-4 border-t border-white/[0.07] pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-end">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-200/70">
                  <Sparkles className="h-3.5 w-3.5" /> {t.music.aiGeneratedMix}
                </span>
                <h3 className="mt-2 font-display text-xl font-extrabold text-white">
                  {aiPlaylist.data.mix.title}
                </h3>
                <p className="mt-1 text-sm text-white/45">{aiPlaylist.data.mix.subtitle}</p>
                <p className="mt-2 text-xs font-medium text-white/60">
                  {t.music.aiPlaylistMatchedCount(
                    aiPlaylist.data.matchedCount,
                    aiPlaylist.data.requestedCount,
                  )}
                </p>
                {aiPlaylist.data.constraints.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {aiPlaylist.data.constraints.map((constraint) => (
                      <span
                        key={constraint}
                        className="rounded-full border border-fuchsia-300/15 bg-fuchsia-300/[0.06] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-100/70"
                      >
                        {constraint}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!aiPlaylist.data.mix.tracks.length}
                    onClick={() => player.playShuffledTracks(aiPlaylist.data!.mix.tracks)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <Shuffle className="h-3.5 w-3.5" /> {t.music.shufflePlay}
                  </button>
                  <button
                    type="button"
                    disabled={aiPlaylist.isPending}
                    onClick={() => generateAiPlaylist(lastAiPrompt)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${aiPlaylist.isPending ? 'animate-spin' : ''}`}
                    />
                    {t.music.aiPlaylistRegenerate}
                  </button>
                </div>
              </div>
              <MusicMixCard
                mix={aiPlaylist.data.mix}
                landscape
                onPlay={() => player.playTracks(aiPlaylist.data!.mix.tracks)}
                onSave={() => save(aiPlaylist.data!.mix)}
                saving={savingId === aiPlaylist.data.mix.id}
                saved={savedIds.has(aiPlaylist.data.mix.id)}
              />
            </div>
          )}
        </section>
      )}

      {!hasDiscoveryContent && (
        <section className="rounded-3xl border border-white/[0.08] bg-white/[0.03] px-6 py-14 text-center">
          <RadioTower className="mx-auto h-10 w-10 text-zinc-700" />
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-zinc-500">
            {t.music.noMixesYet}
          </p>
        </section>
      )}

      {!!data.mixes.length && (
        <section className="space-y-4">
          <SectionTitle
            eyebrow={t.music.madeForYou}
            title={t.music.smartMixes}
            description={t.music.smartMixesDescription}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {data.mixes.map((mix) => (
              <MusicMixCard
                key={mix.id}
                mix={mix}
                landscape
                onPlay={() => player.playTracks(mix.tracks)}
                onSave={() => save(mix)}
                saving={savingId === mix.id}
                saved={savedIds.has(mix.id)}
              />
            ))}
          </div>
        </section>
      )}

      {!!data.moodCollections.length && (
        <section className="space-y-4">
          <SectionTitle
            eyebrow={t.music.chooseYourMood}
            title={t.music.moodStations}
            description={t.music.moodStationsDescription}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.moodCollections.map((mix) => (
              <MusicMixCard
                key={mix.id}
                mix={mix}
                compact
                landscape
                onPlay={() => player.playTracks(mix.tracks)}
                onSave={() => save(mix)}
                saving={savingId === mix.id}
                saved={savedIds.has(mix.id)}
              />
            ))}
          </div>
        </section>
      )}

      {!!data.genreCollections.length && (
        <section className="space-y-4">
          <SectionTitle
            eyebrow={t.music.fromYourLibrary}
            title={t.music.genreStations}
            description={t.music.genreStationsDescription}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.genreCollections.map((mix) => (
              <MusicMixCard
                key={mix.id}
                mix={mix}
                compact
                landscape
                onPlay={() => player.playTracks(mix.tracks)}
                onSave={() => save(mix)}
                saving={savingId === mix.id}
                saved={savedIds.has(mix.id)}
              />
            ))}
          </div>
        </section>
      )}

      {!!data.decadeCollections.length && (
        <section className="space-y-4">
          <SectionTitle
            eyebrow={t.music.timeTravel}
            title={t.music.decades}
            description={t.music.decadesDescription}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.decadeCollections.map((mix) => (
              <MusicMixCard
                key={mix.id}
                mix={mix}
                compact
                landscape
                onPlay={() => player.playTracks(mix.tracks)}
                onSave={() => save(mix)}
                saving={savingId === mix.id}
                saved={savedIds.has(mix.id)}
              />
            ))}
          </div>
        </section>
      )}

      {!!data.radioArtists.length && (
        <section className="space-y-4">
          <SectionTitle
            eyebrow={t.music.radio}
            title={t.music.artistRadios}
            description={t.music.artistRadiosDescription}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data.radioArtists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                onClick={() => startArtistRadio(artist.id)}
                disabled={artistRadio.isPending}
                aria-label={t.music.playArtistRadio(artist.name)}
                className="group min-w-0 rounded-2xl border border-white/[0.08] bg-[#0d0f12] p-3 text-left transition hover:-translate-y-0.5 hover:border-white/15 hover:bg-[#12151a] disabled:opacity-60"
              >
                <span className="relative block aspect-square overflow-hidden rounded-xl bg-zinc-900">
                  {artist.artworkUrl ? (
                    <img
                      src={artist.artworkUrl}
                      alt=""
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center bg-gradient-to-br from-brand-950 to-zinc-950">
                      <Disc3 className="h-10 w-10 text-white/20" />
                    </span>
                  )}
                  <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-xl">
                    {radioArtistId === artist.id ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RadioTower className="h-4 w-4" />
                    )}
                  </span>
                </span>
                <span className="mt-3 block truncate text-sm font-bold text-white">
                  {artist.name}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                  <UsersRound className="h-3 w-3" /> {t.music.diverseArtistRadio}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@cinedrive/prisma';
import type { MusicMixDto, MusicTrackDto, PlaylistIntent } from '@cinedrive/shared';
import { accessibleLibraryFilter } from '../utils/library-access.js';
import { findMusicTracksByIdsWithRelations, formatMusicTrack } from '../utils/music-format.js';
import { type DiscoveryCandidate, loadDiscoveryCandidates } from './music-discovery-candidates.js';
import { selectDiscoveryCandidates, stableNumber } from './music-discovery-selection.js';
import { buildMusicCatalogueSummary, MusicAiIntentPlanner } from './music-ai-intent.js';
import type { MusicAiProvider } from './music-ai-provider.js';
import { MusicAiProviderError } from './music-ai-provider.js';
import {
  isHardLanguageEvidenceAccepted,
  persistedTrackLanguageEvidence,
  type MusicLanguageSource,
} from './music-language-evidence.js';

const INTENT_CACHE_TTL_MS = 2 * 60_000;
const HISTORY_LIMIT = 2_000;
const RECENT_TRACK_LIMIT = 120;

export interface AiPlaylistHistoryEntry {
  trackId: string;
  playedAt: Date;
  listenedSeconds: number;
  track: { duration: number | null };
}

export interface MusicAiPlaylistResult {
  intent: PlaylistIntent;
  mix: MusicMixDto;
  generatedAt: string;
  requestedCount: number;
  matchedCount: number;
  constraints: string[];
}

const normalizeArtist = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .trim();

const normalizedCandidateGenres = (candidate: DiscoveryCandidate) =>
  new Set(
    [...candidate.genres, ...candidate.albumGenres]
      .map((genre) =>
        genre
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('en-US')
          .replace(/[^\p{L}\p{N}&]+/gu, ' ')
          .trim(),
      )
      .filter(Boolean),
  );

const GENRE_FAMILY_ALIASES: Record<string, string[]> = {
  alternative: ['alternative'],
  blues: ['blues'],
  classical: ['classical'],
  country: ['country'],
  electronic: ['electronic', 'electronica'],
  folk: ['folk'],
  indie: ['indie'],
  jazz: ['jazz'],
  metal: ['metal'],
  pop: ['pop'],
  punk: ['punk'],
  'r b': ['r b', 'rnb', 'rhythm blues'],
  rap: ['rap', 'hip hop', 'hiphop'],
  reggae: ['reggae'],
  rock: ['rock'],
  soul: ['soul'],
};

const genreMatches = (candidateGenres: Set<string>, requested: string) => {
  const normalizedRequested = normalizeArtist(requested);
  const aliases = GENRE_FAMILY_ALIASES[normalizedRequested] || [normalizedRequested];
  return [...candidateGenres].some((candidate) => {
    if (candidate === normalizedRequested) return true;
    const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
    return aliases.some((alias) =>
      alias
        .split(' ')
        .filter(Boolean)
        .every((token) => candidateTokens.has(token)),
    );
  });
};

type ConstraintEvidence = {
  status: 'match' | 'mismatch' | 'unknown';
  confidence: number;
  source: MusicLanguageSource;
  actual: string | null;
  requested: string[];
  hardAccepted: boolean;
  hardMatch: boolean;
};

const COUNTRY_GENRE_SIGNALS: Record<string, string[]> = {
  TR: ['turkish', 'turkce', 'anatolian'],
  GB: ['british', 'uk'],
  JP: ['japanese', 'j pop', 'j rock'],
  KR: ['korean', 'k pop', 'k rock'],
  FR: ['french'],
};

const genresContainSignal = (genres: Set<string>, signals: string[]) =>
  signals.some((signal) => genreMatches(genres, signal));

export const evaluateCandidateLanguage = (
  candidate: DiscoveryCandidate,
  requestedLanguages: string[],
): ConstraintEvidence => {
  const evidence = persistedTrackLanguageEvidence(candidate);
  const hardAccepted = isHardLanguageEvidenceAccepted(evidence);
  if (!requestedLanguages.length || !evidence.language || !hardAccepted) {
    return {
      status: 'unknown',
      confidence: evidence.confidence,
      source: evidence.source,
      actual: evidence.language,
      requested: requestedLanguages,
      hardAccepted,
      hardMatch: false,
    };
  }
  return {
    status: requestedLanguages.includes(evidence.language) ? 'match' : 'mismatch',
    confidence: evidence.confidence,
    source: evidence.source,
    actual: evidence.language,
    requested: requestedLanguages,
    hardAccepted,
    hardMatch: requestedLanguages.includes(evidence.language),
  };
};

const evaluateCandidateLocale = (
  candidate: DiscoveryCandidate,
  countries: string[],
  scenes: string[],
): ConstraintEvidence => {
  if (!countries.length && !scenes.length)
    return { status: 'unknown', confidence: 0, source: 'unknown', actual: null, requested: [], hardAccepted: false, hardMatch: false };
  const genres = normalizedCandidateGenres(candidate);
  if (
    scenes.some((scene) => genreMatches(genres, scene)) ||
    countries.some((country) => genresContainSignal(genres, COUNTRY_GENRE_SIGNALS[country] || []))
  ) {
    return { status: 'match', confidence: 0.75, source: 'genre', actual: null, requested: [], hardAccepted: false, hardMatch: false };
  }
  return { status: 'unknown', confidence: 0, source: 'unknown', actual: null, requested: [], hardAccepted: false, hardMatch: false };
};

const isMeaningfulListen = (entry: AiPlaylistHistoryEntry) => {
  const threshold = entry.track.duration ? Math.min(30, entry.track.duration * 0.45) : 15;
  return entry.listenedSeconds >= threshold;
};

const inYearRange = (
  candidate: DiscoveryCandidate,
  minimum: number | null,
  maximum: number | null,
) => {
  const year = candidate.year || candidate.albumYear;
  if (!year) return false;
  return (minimum === null || year >= minimum) && (maximum === null || year <= maximum);
};

export interface CandidateIntentExplanation {
  yearMatch: boolean | null;
  genreMatch: boolean | null;
  languageMatch: ConstraintEvidence;
  localeMatch: ConstraintEvidence;
  exclusionPassed: boolean;
  hardConstraintPassed: boolean;
}

export const explainCandidateIntent = (
  candidate: DiscoveryCandidate,
  intent: PlaylistIntent,
): CandidateIntentExplanation => {
  const genres = normalizedCandidateGenres(candidate);
  const artist = normalizeArtist(candidate.artistName || '');
  const excludedByGenre = intent.excludedGenres.some((genre) => genreMatches(genres, genre));
  const excludedByArtist = intent.excludedArtistNames.includes(artist);
  const excludedLanguage = evaluateCandidateLanguage(candidate, intent.language.excludedLanguages);
  const exclusionPassed =
    !excludedByGenre && !excludedByArtist && excludedLanguage.status !== 'match';

  const hardGenres = intent.genres.filter((genre) => genre.mode === 'hard');
  const genreMatch = hardGenres.length
    ? hardGenres.some((genre) => genreMatches(genres, genre.name))
    : null;
  const hardArtists = intent.artists.filter((item) => item.mode === 'hard');
  const artistMatch = hardArtists.length ? hardArtists.some((item) => item.name === artist) : null;
  const hasHardYear =
    intent.year.mode === 'hard' && (intent.year.min !== null || intent.year.max !== null);
  const yearMatch = hasHardYear ? inYearRange(candidate, intent.year.min, intent.year.max) : null;
  const languageMatch = evaluateCandidateLanguage(candidate, intent.language.languages);
  const hasHardLanguage = intent.language.mode === 'hard' && intent.language.languages.length > 0;
  const localeMatch = evaluateCandidateLocale(
    candidate,
    intent.locale.countries,
    intent.locale.scenes,
  );
  const hasHardLocale =
    intent.locale.mode === 'hard' &&
    (intent.locale.countries.length > 0 || intent.locale.scenes.length > 0);
  return {
    yearMatch,
    genreMatch,
    languageMatch,
    localeMatch,
    exclusionPassed,
    hardConstraintPassed:
      exclusionPassed &&
      genreMatch !== false &&
      artistMatch !== false &&
      yearMatch !== false &&
      (!hasHardLanguage || languageMatch.status === 'match') &&
      (!hasHardLocale || localeMatch.status === 'match'),
  };
};

export const matchesCandidateHardIntent = (candidate: DiscoveryCandidate, intent: PlaylistIntent) =>
  explainCandidateIntent(candidate, intent).hardConstraintPassed;

const preferenceScore = (candidate: DiscoveryCandidate, intent: PlaylistIntent) => {
  const genres = normalizedCandidateGenres(candidate);
  const artist = normalizeArtist(candidate.artistName || '');
  const genre = intent.genres.reduce(
    (score, item) => Math.max(score, genreMatches(genres, item.name) ? item.weight : 0),
    0,
  );
  const artistPreference = intent.artists.reduce(
    (score, item) => Math.max(score, item.name === artist ? item.weight : 0),
    0,
  );
  let year = 0;
  const candidateYear = candidate.year || candidate.albumYear;
  if (candidateYear && (intent.year.min !== null || intent.year.max !== null)) {
    if (inYearRange(candidate, intent.year.min, intent.year.max)) year = intent.year.weight;
    else {
      const distance = Math.min(
        intent.year.min === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(candidateYear - intent.year.min),
        intent.year.max === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(candidateYear - intent.year.max),
      );
      year = intent.year.weight * Math.max(0, 1 - distance / 20);
    }
  }
  const language = evaluateCandidateLanguage(candidate, intent.language.languages);
  const languagePreference =
    language.status === 'match' ? intent.language.weight : language.status === 'unknown' ? 0.12 : 0;
  const locale = evaluateCandidateLocale(candidate, intent.locale.countries, intent.locale.scenes);
  const localePreference = locale.status === 'match' ? intent.locale.weight : 0;
  return (
    genre * 34 + artistPreference * 38 + year * 24 + languagePreference * 34 + localePreference * 18
  );
};

export const selectAiPlaylistCandidates = (
  candidates: DiscoveryCandidate[],
  history: AiPlaylistHistoryEntry[],
  intent: PlaylistIntent,
  generationId: string,
) => {
  const meaningful = history.filter(isMeaningfulListen);
  const listened = new Set(meaningful.map((entry) => entry.trackId));
  const recentIndex = new Map(
    meaningful.slice(0, RECENT_TRACK_LIMIT).map((entry, index) => [entry.trackId, index]),
  );
  const lastPlayedAt = new Map<string, Date>();
  for (const entry of meaningful)
    if (!lastPlayedAt.has(entry.trackId)) lastPlayedAt.set(entry.trackId, entry.playedAt);

  const pool = candidates.filter((candidate) => matchesCandidateHardIntent(candidate, intent));
  const maxLogPlay = Math.max(1, ...candidates.map((candidate) => Math.log1p(candidate.playCount)));
  let now = 0;
  for (const candidate of candidates)
    now = Math.max(now, candidate.updatedAt.getTime(), candidate.createdAt.getTime());
  for (const entry of meaningful) now = Math.max(now, entry.playedAt.getTime());
  if (!now) now = Date.now();
  const maxLibraryAge = Math.max(
    1,
    ...candidates.map((candidate) => Math.log1p(Math.max(0, now - candidate.createdAt.getTime()))),
  );

  const modeExploration =
    intent.seedMode === 'discovery' ? 1 : intent.seedMode === 'familiar' ? 0.2 : 0.6;
  const requestedExploration = Math.max(intent.exploration, modeExploration);

  const scored = pool.map((candidate) => {
    const playFamiliarity = Math.log1p(candidate.playCount) / maxLogPlay;
    const lowPlay = 1 - playFamiliarity;
    const unheard = listened.has(candidate.id) ? 0 : 1;
    const libraryAge = Math.log1p(Math.max(0, now - candidate.createdAt.getTime())) / maxLibraryAge;
    const lastPlayed = lastPlayedAt.get(candidate.id);
    const daysSincePlayed = lastPlayed
      ? Math.max(0, now - lastPlayed.getTime()) / 86_400_000
      : 3650;
    const dormant = Math.min(1, Math.log1p(daysSincePlayed) / Math.log1p(3650));
    const recent = recentIndex.has(candidate.id)
      ? Math.max(0, 1 - recentIndex.get(candidate.id)! / RECENT_TRACK_LIMIT)
      : 0;
    const preference = preferenceScore(candidate, intent);
    const familiarSignal = playFamiliarity * 0.7 + (candidate.isFavorite ? 0.3 : 0);
    const discoverySignal = unheard * 0.45 + lowPlay * 0.3 + dormant * 0.25;
    const personal =
      (candidate.isFavorite ? intent.favoriteBias * 52 : 0) +
      unheard * intent.unheardBias * 28 +
      lowPlay * intent.lowPlayCountBias * 22 +
      libraryAge * intent.oldLibraryBias * 13 -
      recent * intent.recentPlayPenalty * 34;
    return {
      value: candidate,
      id: candidate.id,
      artistKey: candidate.artistId || `unknown:${candidate.id}`,
      albumKey: candidate.albumId || `single:${candidate.id}`,
      relevance:
        preference +
        personal +
        familiarSignal * intent.familiarity * 30 +
        discoverySignal * requestedExploration * 10,
      exploration:
        preference * 0.55 +
        personal +
        discoverySignal * requestedExploration * 42 -
        familiarSignal * (1 - intent.familiarity) * 8,
    };
  });

  const artistLimit = intent.artistDiversity >= 0.75 ? 2 : intent.artistDiversity >= 0.4 ? 4 : 6;
  const albumLimit = intent.albumDiversity >= 0.75 ? 1 : intent.albumDiversity >= 0.4 ? 2 : 3;
  return selectDiscoveryCandidates(
    scored,
    `ai:${generationId}`,
    Math.min(intent.targetCount, scored.length),
    undefined,
    {
      relevanceRatio: Math.min(0.9, Math.max(0.35, 0.8 - requestedExploration * 0.4)),
      artistLimit,
      albumLimit,
    },
  );
};

const catalogueFingerprint = (candidates: DiscoveryCandidate[]) => {
  const hash = createHash('sha256');
  for (const candidate of candidates) {
    hash.update(candidate.id);
    hash.update(String(candidate.updatedAt.getTime()));
    hash.update(String(candidate.playCount));
    hash.update(candidate.isFavorite ? '1' : '0');
  }
  return hash.digest('base64url').slice(0, 22);
};

const promptKey = (prompt: string) => prompt.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');

const LANGUAGE_LABELS: Record<string, string> = {
  tr: 'Türkçe',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
};

export const describeHardIntentConstraints = (intent: PlaylistIntent) => {
  const constraints: string[] = [];
  if (intent.language.mode === 'hard')
    constraints.push(
      ...intent.language.languages.map((language) => LANGUAGE_LABELS[language] || language),
    );
  constraints.push(
    ...intent.genres
      .filter((genre) => genre.mode === 'hard')
      .map((genre) => genre.name.replace(/\b\w/g, (letter) => letter.toUpperCase())),
  );
  if (intent.year.mode === 'hard' && intent.year.min !== null && intent.year.max !== null)
    constraints.push(
      intent.year.min === intent.year.max
        ? String(intent.year.min)
        : `${intent.year.min}–${intent.year.max}`,
    );
  constraints.push(
    ...intent.artists.filter((artist) => artist.mode === 'hard').map((artist) => artist.name),
    ...intent.excludedGenres.map((genre) => `${genre} hariç`),
    ...intent.language.excludedLanguages.map(
      (language) => `${LANGUAGE_LABELS[language] || language} hariç`,
    ),
  );
  return [...new Set(constraints)];
};

export class MusicAiPlaylistService {
  private readonly planner: MusicAiIntentPlanner | null;
  private readonly intentCache = new Map<string, { expiresAt: number; intent: PlaylistIntent }>();
  private readonly intentInflight = new Map<string, Promise<PlaylistIntent>>();

  constructor(
    private readonly prisma: PrismaClient,
    provider: MusicAiProvider | null,
  ) {
    this.planner = provider ? new MusicAiIntentPlanner(provider) : null;
  }

  public isEnabled() {
    return this.planner !== null;
  }

  public async generate(
    userId: string,
    prompt: string,
    generationId: string,
  ): Promise<MusicAiPlaylistResult> {
    if (!this.planner) throw new MusicAiProviderError('missing-api-key');
    const candidates = await loadDiscoveryCandidates(this.prisma, userId);
    const summary = buildMusicCatalogueSummary(candidates);
    const fingerprint = catalogueFingerprint(candidates);
    const cacheKey = createHash('sha256')
      .update(`${userId}\u0000${promptKey(prompt)}\u0000${fingerprint}\u0000${generationId}`)
      .digest('base64url');
    const now = Date.now();
    for (const [key, entry] of this.intentCache)
      if (entry.expiresAt <= now) this.intentCache.delete(key);
    let intent = this.intentCache.get(cacheKey)?.intent;
    if (!intent) {
      let planning = this.intentInflight.get(cacheKey);
      if (!planning) {
        planning = this.planner.plan(prompt, summary, {
          artistNames: [
            ...new Set(
              candidates
                .map((candidate) => candidate.artistName)
                .filter((name): name is string => !!name),
            ),
          ],
        });
        this.intentInflight.set(cacheKey, planning);
      }
      try {
        intent = await planning;
        this.intentCache.set(cacheKey, { expiresAt: Date.now() + INTENT_CACHE_TTL_MS, intent });
      } finally {
        this.intentInflight.delete(cacheKey);
      }
    }

    const history = await this.prisma.musicHistory.findMany({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      take: HISTORY_LIMIT,
      select: {
        trackId: true,
        playedAt: true,
        listenedSeconds: true,
        track: { select: { duration: true } },
      },
    });
    const selected = selectAiPlaylistCandidates(candidates, history, intent, generationId);
    const matchedCount = candidates.filter((candidate) =>
      matchesCandidateHardIntent(candidate, intent),
    ).length;
    const hydrated = await findMusicTracksByIdsWithRelations(
      this.prisma,
      userId,
      selected.map((candidate) => candidate.id),
      { library: accessibleLibraryFilter(userId) },
    );
    const tracksById = new Map(hydrated.map(formatMusicTrack).map((track) => [track.id, track]));
    const tracks = selected.flatMap((candidate) => {
      const track = tracksById.get(candidate.id);
      return track ? [track] : [];
    });
    const artworkUrls = [
      ...new Set(tracks.map((track: MusicTrackDto) => track.artworkUrl).filter(Boolean)),
    ].slice(0, 4) as string[];
    const promptHash = createHash('sha256')
      .update(promptKey(prompt))
      .digest('base64url')
      .slice(0, 10);
    const mix: MusicMixDto = {
      id: `ai-${promptHash}-${generationId}`,
      type: 'ai',
      title: intent.title,
      subtitle: intent.subtitle,
      accent: ['violet', 'cyan', 'indigo'][stableNumber(generationId) % 3]!,
      artworkUrls,
      tracks,
      candidateCount: matchedCount,
      trackCount: tracks.length,
    };
    return {
      intent,
      mix,
      generatedAt: new Date().toISOString(),
      requestedCount: intent.targetCount,
      matchedCount,
      constraints: describeHardIntentConstraints(intent),
    };
  }
}

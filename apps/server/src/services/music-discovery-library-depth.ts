import type { DiscoveryCandidate } from './music-discovery-candidates.js';

const DAY_MS = 86_400_000;

export interface DiscoveryHistorySignal {
  meaningfulPlayCount: number;
  completionTotal: number;
  lastMeaningfulPlayAt: Date;
}

export interface LibraryDepthPlanDefinition {
  id:
    'library-depth-long-unplayed' | 'library-depth-least-played' | 'library-depth-hidden-favorites';
  title: string;
  subtitle: string;
  titleKey: string;
  subtitleKey: string;
  candidates: DiscoveryCandidate[];
  relevance: (candidate: DiscoveryCandidate) => number;
}

const percentile = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * ratio))]!;
};

const daysBetween = (newer: number, older: Date) => Math.max(0, (newer - older.getTime()) / DAY_MS);

/**
 * Produces semantic candidate pools and scores only. Final seeded sampling,
 * cross-section de-duplication and artist/album diversity remain owned by the
 * existing Discovery V2 selection engine.
 */
export const buildLibraryDepthPlanDefinitions = ({
  candidates,
  historySignals,
  currentTime,
  preferenceScore,
  explorationScore,
  isRecentlyPlayed,
}: {
  candidates: DiscoveryCandidate[];
  historySignals: Map<string, DiscoveryHistorySignal>;
  currentTime: number;
  preferenceScore: (candidate: DiscoveryCandidate) => number;
  explorationScore: (candidate: DiscoveryCandidate) => number;
  isRecentlyPlayed: (candidate: DiscoveryCandidate) => boolean;
}): LibraryDepthPlanDefinition[] => {
  if (!candidates.length) return [];

  const listenedCandidates = candidates.filter((candidate) => historySignals.has(candidate.id));
  const inactivityDays = listenedCandidates.map((candidate) =>
    daysBetween(currentTime, historySignals.get(candidate.id)!.lastMeaningfulPlayAt),
  );
  const longUnplayedThreshold = Math.max(1, percentile(inactivityDays, 0.55));
  const longUnplayed = listenedCandidates.filter(
    (candidate) =>
      !isRecentlyPlayed(candidate) &&
      daysBetween(currentTime, historySignals.get(candidate.id)!.lastMeaningfulPlayAt) >=
        longUnplayedThreshold,
  );

  // Exclude the newest quarter of a mixed-age library so a just-imported batch
  // cannot dominate solely because every track starts at playCount zero.
  const libraryAges = candidates.map((candidate) => daysBetween(currentTime, candidate.createdAt));
  const matureLibraryThreshold = percentile(libraryAges, 0.25);
  const leastPlayed = candidates.filter(
    (candidate) => daysBetween(currentTime, candidate.createdAt) >= matureLibraryThreshold,
  );

  const hiddenFavoriteInactivity = Math.max(1, percentile(inactivityDays, 0.4));
  const hiddenFavorites = listenedCandidates.filter((candidate) => {
    const signal = historySignals.get(candidate.id)!;
    const averageCompletion = signal.completionTotal / signal.meaningfulPlayCount;
    const directAffinityEvidence =
      signal.meaningfulPlayCount >= 2 ||
      averageCompletion >= 0.9 ||
      (candidate.isFavorite && averageCompletion >= 0.75);
    return (
      directAffinityEvidence &&
      !isRecentlyPlayed(candidate) &&
      daysBetween(currentTime, signal.lastMeaningfulPlayAt) >= hiddenFavoriteInactivity
    );
  });

  const definitions: Array<LibraryDepthPlanDefinition | null> = [
    longUnplayed.length
      ? {
          id: 'library-depth-long-unplayed',
          title: 'Uzun Süredir Dinlemediklerin',
          subtitle: 'Unutulmuş hazineler',
          titleKey: 'music.discovery.libraryDepth.longUnplayed.title',
          subtitleKey: 'music.discovery.libraryDepth.longUnplayed.subtitle',
          candidates: longUnplayed,
          relevance: (candidate) => {
            const signal = historySignals.get(candidate.id)!;
            return (
              Math.log1p(daysBetween(currentTime, signal.lastMeaningfulPlayAt)) * 8 +
              Math.log1p(signal.meaningfulPlayCount) * 2 +
              preferenceScore(candidate) * 0.55
            );
          },
        }
      : null,
    leastPlayed.length
      ? {
          id: 'library-depth-least-played',
          title: 'En Az Çaldıkların',
          subtitle: 'Yeni bir şans ver',
          titleKey: 'music.discovery.libraryDepth.leastPlayed.title',
          subtitleKey: 'music.discovery.libraryDepth.leastPlayed.subtitle',
          candidates: leastPlayed,
          relevance: (candidate) =>
            explorationScore(candidate) +
            Math.log1p(daysBetween(currentTime, candidate.createdAt)) * 3 -
            Math.log1p(candidate.playCount) * 12,
        }
      : null,
    hiddenFavorites.length
      ? {
          id: 'library-depth-hidden-favorites',
          title: 'Gizli Favoriler',
          subtitle: 'Keşfedilmeyi bekleyenler',
          titleKey: 'music.discovery.libraryDepth.hiddenFavorites.title',
          subtitleKey: 'music.discovery.libraryDepth.hiddenFavorites.subtitle',
          candidates: hiddenFavorites,
          relevance: (candidate) => {
            const signal = historySignals.get(candidate.id)!;
            const averageCompletion = signal.completionTotal / signal.meaningfulPlayCount;
            return (
              Math.log1p(signal.meaningfulPlayCount) * 12 +
              averageCompletion * 18 +
              preferenceScore(candidate) * 0.65 +
              Math.log1p(daysBetween(currentTime, signal.lastMeaningfulPlayAt)) * 2 +
              (candidate.isFavorite ? 4 : 0)
            );
          },
        }
      : null,
  ];

  return definitions.filter((definition): definition is LibraryDepthPlanDefinition => !!definition);
};

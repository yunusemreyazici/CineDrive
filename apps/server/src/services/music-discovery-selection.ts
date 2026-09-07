export const DISCOVERY_LIMITS = {
  personalized: 45,
  collection: 50,
  fallback: 45,
  radio: 60,
} as const;

export const DISCOVERY_SELECTION_POLICY = {
  relevanceRatio: 0.65,
  artistLimit: 4,
  albumLimit: 2,
  globalArtistLimit: 12,
} as const;

export interface DiscoverySelectionCandidate<T> {
  value: T;
  id: string;
  artistKey: string;
  albumKey: string;
  relevance: number;
  exploration: number;
}

export interface DiscoverySelectionContext {
  usedTrackIds: Set<string>;
  artistCounts: Map<string, number>;
}

export interface DiscoverySelectionPolicyOverride {
  relevanceRatio?: number;
  artistLimit?: number;
  albumLimit?: number;
  globalArtistLimit?: number;
}

export const createDiscoverySelectionContext = (): DiscoverySelectionContext => ({
  usedTrackIds: new Set(),
  artistCounts: new Map(),
});

export const stableNumber = (value: string) => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

const stableUnit = (value: string) => (stableNumber(value) + 1) / 4_294_967_297;

const weightedOrder = <T>(
  candidates: DiscoverySelectionCandidate<T>[],
  score: (candidate: DiscoverySelectionCandidate<T>) => number,
  seed: string,
  context: DiscoverySelectionContext,
) => {
  if (!candidates.length) return [];
  const scores = candidates.map(score);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const candidateScore of scores) {
    minimum = Math.min(minimum, candidateScore);
    maximum = Math.max(maximum, candidateScore);
  }
  const span = Math.max(1, maximum - minimum);

  return candidates
    .map((candidate, index) => {
      const normalized = (scores[index]! - minimum) / span;
      const globalArtistUses = context.artistCounts.get(candidate.artistKey) || 0;
      const weight = (0.25 + normalized * 3.75) / (1 + globalArtistUses * 0.45);
      return {
        candidate,
        priority: -Math.log(stableUnit(`${seed}:${candidate.id}`)) / weight,
      };
    })
    .sort(
      (left, right) =>
        left.priority - right.priority || left.candidate.id.localeCompare(right.candidate.id),
    )
    .map(({ candidate }) => candidate);
};

interface SelectionPass {
  allowUsedTracks: boolean;
  capMultiplier: number;
}

/**
 * Seeded weighted sampling keeps strong preference signals while reserving a
 * fixed share for long-tail exploration. A shared context first excludes tracks
 * already visible elsewhere in the response and limits page-wide artist reuse;
 * later passes relax those rules only when the pool cannot fill the collection.
 */
export const selectDiscoveryCandidates = <T>(
  candidates: DiscoverySelectionCandidate<T>[],
  seed: string,
  limit: number,
  context: DiscoverySelectionContext = createDiscoverySelectionContext(),
  policy: DiscoverySelectionPolicyOverride = {},
): T[] => {
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const relevanceOrder = weightedOrder(
    unique,
    (candidate) => candidate.relevance,
    `${seed}:r`,
    context,
  );
  const explorationOrder = weightedOrder(
    unique,
    (candidate) => candidate.exploration,
    `${seed}:e`,
    context,
  );
  const selected: DiscoverySelectionCandidate<T>[] = [];
  const selectedIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const relevanceRatio = Math.min(
    1,
    Math.max(0, policy.relevanceRatio ?? DISCOVERY_SELECTION_POLICY.relevanceRatio),
  );
  const artistLimit = Math.max(1, policy.artistLimit ?? DISCOVERY_SELECTION_POLICY.artistLimit);
  const albumLimit = Math.max(1, policy.albumLimit ?? DISCOVERY_SELECTION_POLICY.albumLimit);
  const globalArtistLimit = Math.max(
    1,
    policy.globalArtistLimit ?? DISCOVERY_SELECTION_POLICY.globalArtistLimit,
  );
  const relevanceTarget = Math.round(limit * relevanceRatio);
  const explorationTarget = Math.max(0, limit - relevanceTarget);

  const addFrom = (
    ordered: DiscoverySelectionCandidate<T>[],
    target: number,
    pass: SelectionPass,
  ) => {
    let added = 0;
    for (const candidate of ordered) {
      if (selected.length >= limit || added >= target || selectedIds.has(candidate.id)) continue;
      if (!pass.allowUsedTracks && context.usedTrackIds.has(candidate.id)) continue;
      const localArtistCount = artistCounts.get(candidate.artistKey) || 0;
      const localAlbumCount = albumCounts.get(candidate.albumKey) || 0;
      const globalArtistCount = context.artistCounts.get(candidate.artistKey) || 0;
      if (
        localArtistCount >= artistLimit * pass.capMultiplier ||
        localAlbumCount >= albumLimit * pass.capMultiplier ||
        globalArtistCount >= globalArtistLimit * pass.capMultiplier
      )
        continue;
      selected.push(candidate);
      selectedIds.add(candidate.id);
      artistCounts.set(candidate.artistKey, localArtistCount + 1);
      albumCounts.set(candidate.albumKey, localAlbumCount + 1);
      added += 1;
    }
  };

  const strictPass = { allowUsedTracks: false, capMultiplier: 1 };
  addFrom(relevanceOrder, relevanceTarget, strictPass);
  addFrom(explorationOrder, explorationTarget, strictPass);

  for (const pass of [
    { allowUsedTracks: false, capMultiplier: 2 },
    { allowUsedTracks: true, capMultiplier: 2 },
    { allowUsedTracks: true, capMultiplier: Number.POSITIVE_INFINITY },
  ]) {
    addFrom([...relevanceOrder, ...explorationOrder], limit - selected.length, pass);
    if (selected.length >= limit) break;
  }

  for (const candidate of selected) {
    context.usedTrackIds.add(candidate.id);
    context.artistCounts.set(
      candidate.artistKey,
      (context.artistCounts.get(candidate.artistKey) || 0) + 1,
    );
  }
  return selected.map((candidate) => candidate.value);
};

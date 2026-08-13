import type { MusicTrackDto } from '@cinedrive/shared';

export interface MusicQueueEntry {
  id: string;
  trackId: string;
  sourceOrder: number;
  playOrder: number;
  track: MusicTrackDto;
}

const nextSourceOrder = (items: MusicQueueEntry[]) =>
  items.reduce((highest, item) => Math.max(highest, item.sourceOrder), -1) + 1;

const nextPlayOrder = (items: MusicQueueEntry[]) =>
  items.reduce((highest, item) => Math.max(highest, item.playOrder), -1) + 1;

export const remainingMusicQueueEntries = (items: MusicQueueEntry[], currentId: string | null) => {
  if (!currentId) return Number.POSITIVE_INFINITY;
  const ordered = [...items].sort((left, right) => left.playOrder - right.playOrder);
  const currentIndex = ordered.findIndex((item) => item.id === currentId);
  return currentIndex < 0 ? Number.POSITIVE_INFINITY : ordered.length - currentIndex - 1;
};

export const appendMusicQueueEntry = (
  items: MusicQueueEntry[],
  track: MusicTrackDto,
  id: string,
) => [
  ...items,
  {
    id,
    trackId: track.id,
    sourceOrder: nextSourceOrder(items),
    playOrder: items.length,
    track,
  },
];

export const appendUniqueMusicQueueEntries = (
  items: MusicQueueEntry[],
  tracks: MusicTrackDto[],
  makeId: () => string,
  limit = 40,
) => {
  const existingIds = new Set(items.map((item) => item.trackId));
  const additions = tracks.filter((track) => !existingIds.has(track.id)).slice(0, limit);
  const sourceOrder = nextSourceOrder(items);
  const playOrder = nextPlayOrder(items);
  const added = additions.map((track, index) => ({
    id: makeId(),
    trackId: track.id,
    sourceOrder: sourceOrder + index,
    playOrder: playOrder + index,
    track,
  }));
  return { queue: [...items, ...added], added };
};

export const insertNextMusicQueueEntry = (
  items: MusicQueueEntry[],
  currentId: string | null,
  track: MusicTrackDto,
  id: string,
) => {
  const currentOrder = items.find((item) => item.id === currentId)?.playOrder ?? -1;
  return [
    ...items.map((item) =>
      item.playOrder > currentOrder ? { ...item, playOrder: item.playOrder + 1 } : item,
    ),
    {
      id,
      trackId: track.id,
      sourceOrder: nextSourceOrder(items),
      playOrder: currentOrder + 1,
      track,
    },
  ];
};

export const removeMusicQueueEntry = (items: MusicQueueEntry[], id: string) => {
  const remaining = items.filter((item) => item.id !== id);
  const nextPlayOrders = new Map(
    [...remaining]
      .sort((left, right) => left.playOrder - right.playOrder)
      .map((item, index) => [item.id, index]),
  );
  return remaining.map((item) => ({ ...item, playOrder: nextPlayOrders.get(item.id)! }));
};

export const shuffleMusicTracks = (tracks: MusicTrackDto[], random: () => number = Math.random) => {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
};

export const shuffleMusicQueueEntries = (
  items: MusicQueueEntry[],
  random: () => number = Math.random,
) => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  const playOrders = new Map(shuffled.map((item, index) => [item.id, index]));
  return items.map((item) => ({ ...item, playOrder: playOrders.get(item.id)! }));
};

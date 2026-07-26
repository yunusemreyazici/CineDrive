/**
 * Runs `worker` over every item, keeping at most `limit` in flight.
 *
 * Used for scan work that is independent per file — probing a video's codecs
 * reads its own byte ranges and writes its own row — where doing it one at a
 * time meant one network round trip per file, in series.
 */
export const runWithConcurrency = async <T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  if (items.length === 0) return;

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      // A single failure must not abandon the remaining items; workers are
      // expected to record their own errors.
      await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
};

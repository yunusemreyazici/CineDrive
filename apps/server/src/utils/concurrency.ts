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
  signal?: AbortSignal,
): Promise<void> => {
  if (items.length === 0) return;

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  let stopped = false;

  const runners = Array.from({ length: effectiveLimit }, async () => {
    for (;;) {
      if (stopped) return;
      signal?.throwIfAborted();
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await worker(items[index]!, index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  });

  try {
    await Promise.all(runners);
  } catch (error) {
    stopped = true;
    await Promise.allSettled(runners);
    throw error;
  }
};

/** Run async work over items with a fixed concurrency limit. */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number, workerIndex: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(workerIndex: number): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item, i, workerIndex);
    }
  }

  await Promise.all(
    Array.from({ length: limit }, (_, workerIndex) => worker(workerIndex)),
  );
  return results;
}

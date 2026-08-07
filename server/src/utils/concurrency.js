/**
 * Runs `fn` over `items` with at most `limit` in flight — the JS equivalent of
 * the Python side's `asyncio.Semaphore(10)`. Results keep input order.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

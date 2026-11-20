// Runs asynchronous tasks a few at a time.
//
// On a network drive every file system call waits for a round trip to the
// server. Running the calls one after the other adds these waits up; running
// several at once overlaps them. A limit keeps the number of pending calls
// reasonable on very large folders.

/**
 * Calls `task` on every item, at most `limit` at a time, and returns the results in the
 * order of the items.
 */
export async function mapConcurrently<Item, Result>(
  items: Item[],
  limit: number,
  task: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  // Each runner takes the next item that nobody took yet, until none is left.
  const runner = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await task(items[index]);
    }
  };
  const runnerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: runnerCount }, runner));
  return results;
}

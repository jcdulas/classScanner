// Tests of the helper that runs file system calls a few at a time (src/scanner/concurrency.ts).

import { describe, expect, it } from 'vitest';
import { mapConcurrently } from '../../src/scanner/concurrency';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

describe('mapConcurrently', () => {
  it('returns the results in the order of the items', async () => {
    // The first items take the longest: they finish last.
    const results = await mapConcurrently([3, 2, 1, 0], 4, async (turns) => {
      for (let turn = 0; turn < turns; turn++) {
        await nextTurn();
      }
      return `waited ${turns}`;
    });
    expect(results).toEqual(['waited 3', 'waited 2', 'waited 1', 'waited 0']);
  });

  it('never runs more tasks at once than the limit', async () => {
    let running = 0;
    let mostRunning = 0;
    const items = Array.from({ length: 20 }, (_, index) => index);
    await mapConcurrently(items, 3, async () => {
      running++;
      mostRunning = Math.max(mostRunning, running);
      await nextTurn();
      running--;
    });
    expect(mostRunning).toBe(3);
  });

  it('accepts an empty list', async () => {
    expect(await mapConcurrently([], 4, async () => 1)).toEqual([]);
  });

  it('fails when a task fails', async () => {
    const failing = mapConcurrently([1, 2, 3], 2, async (item) => {
      if (item === 2) {
        throw new Error('unreadable folder');
      }
      return item;
    });
    await expect(failing).rejects.toThrow('unreadable folder');
  });
});

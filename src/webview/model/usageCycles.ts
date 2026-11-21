// Finds the cycles of the "uses" graph (spec §4.9): sets of classes, or of
// groups, where each one uses, directly or through others, every other one.
// None of them can be understood, tested or reused without the rest.
//
// Such a set is a "strongly connected component" of the graph. They are found
// with Kosaraju's algorithm, in two passes:
//   1. walk the graph depth first and note each class when every class it
//      uses has been walked ("finishing order");
//   2. take the classes in the reverse of that order and walk the graph
//      backwards, from a class to the classes that use it: what one such walk
//      reaches, and that no earlier walk reached, is one component.
// Both walks keep their own stack instead of calling themselves, because a
// long chain of classes would overflow the call stack of JavaScript.

import { UsageLink, linksByUser, shortestUsagePath } from './usageLinks';

export interface UsageCycle {
  /** The classes (or the groups) of the cycle, sorted by name. At least two. */
  ids: string[];
  /**
   * A short cycle among them, to show what ties them: each link goes to the `from` of the
   * next one, and the last one comes back to the first.
   */
  example: UsageLink[];
}

/**
 * A short example cycle is searched from this many classes of a component at most. Each search
 * walks the links of the component once, so this bounds the work in a component of thousands
 * of classes; the example is then a short cycle, not always the shortest one. Measured on the
 * synthetic project, whose 1500 classes form one component of 1466: 38 ms for the whole analysis.
 */
const MAX_EXAMPLE_STARTS = 100;

/** The cycles of the graph, the largest first. */
export function findUsageCycles(links: UsageLink[]): UsageCycle[] {
  const successors = linksByUser(links);
  const cycles: UsageCycle[] = [];
  for (const component of stronglyConnectedComponents(links)) {
    if (component.length > 1) {
      const ids = component.sort((first, second) => first.localeCompare(second));
      cycles.push({ ids, example: shortExampleCycle(ids, successors) });
    }
  }
  return cycles.sort((first, second) => second.ids.length - first.ids.length || first.ids[0].localeCompare(second.ids[0]));
}

function shortExampleCycle(ids: string[], successors: Map<string, UsageLink[]>): UsageLink[] {
  const within = new Set(ids);
  let best: UsageLink[] = [];
  for (const startId of ids.slice(0, MAX_EXAMPLE_STARTS)) {
    const cycle = shortestUsagePath(successors, startId, startId, within);
    if (cycle !== undefined && (best.length === 0 || cycle.length < best.length)) {
      best = cycle;
    }
    if (best.length === 2) {
      break; // Two classes that use each other: no cycle is shorter.
    }
  }
  return best;
}

function stronglyConnectedComponents(links: UsageLink[]): string[][] {
  const ids = new Set<string>();
  const usedIdsByUser = new Map<string, string[]>();
  const userIdsByUsed = new Map<string, string[]>();
  for (const link of links) {
    ids.add(link.from);
    ids.add(link.to);
    addToListMap(usedIdsByUser, link.from, link.to);
    addToListMap(userIdsByUsed, link.to, link.from);
  }

  // Pass 1: the finishing order of a depth-first walk along the links.
  const finished: string[] = [];
  const visited = new Set<string>();
  for (const startId of ids) {
    if (visited.has(startId)) {
      continue;
    }
    visited.add(startId);
    // Each entry is a class and the index of the next class it uses to look at.
    const stack: { id: string; nextIndex: number }[] = [{ id: startId, nextIndex: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const usedIds = usedIdsByUser.get(top.id) ?? [];
      if (top.nextIndex < usedIds.length) {
        const usedId = usedIds[top.nextIndex];
        top.nextIndex++;
        if (!visited.has(usedId)) {
          visited.add(usedId);
          stack.push({ id: usedId, nextIndex: 0 });
        }
      } else {
        finished.push(top.id);
        stack.pop();
      }
    }
  }

  // Pass 2: walks against the links, starting from the classes that finished last.
  const components: string[][] = [];
  const assigned = new Set<string>();
  for (let index = finished.length - 1; index >= 0; index--) {
    const startId = finished[index];
    if (assigned.has(startId)) {
      continue;
    }
    assigned.add(startId);
    const component: string[] = [];
    const pending = [startId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      component.push(id);
      for (const userId of userIdsByUsed.get(id) ?? []) {
        if (!assigned.has(userId)) {
          assigned.add(userId);
          pending.push(userId);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function addToListMap(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

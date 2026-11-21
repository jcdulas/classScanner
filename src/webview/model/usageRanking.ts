// Ranks the classes by how much the rest of the code uses them (spec §4.9):
// the most used ones, which everything depends on, and the ones that nothing
// in the scanned code uses.
//
// Only the classes of the scanned files are ranked: a class that is only
// forward-declared is code from somewhere else.

import { Graph } from '../../shared/graphModel';
import { UsageLink } from './usageLinks';

export interface ClassUsage {
  id: string;
  /** Number of classes that use this one. */
  userCount: number;
  /** Number of classes that this one uses. */
  usedCount: number;
}

export interface UsageRanking {
  /** The classes that at least one other class uses, the most used first. */
  mostUsed: ClassUsage[];
  /**
   * The classes that no other class and no free function use, sorted by name. They may still
   * be used from code outside the scanned folder, or in a way that the scan does not see.
   */
  unusedIds: string[];
}

export function rankClassUsage(graph: Graph, links: UsageLink[]): UsageRanking {
  const usageById = new Map<string, ClassUsage>();
  for (const node of graph.nodes) {
    if (!node.isExternal) {
      usageById.set(node.id, { id: node.id, userCount: 0, usedCount: 0 });
    }
  }
  // There is one link per pair of classes, so counting links counts classes.
  for (const link of links) {
    const used = usageById.get(link.to);
    if (used !== undefined) {
      used.userCount++;
    }
    const user = usageById.get(link.from);
    if (user !== undefined) {
      user.usedCount++;
    }
  }
  const usedByFunctions = new Set(graph.functionUses.map((use) => use.to));

  const usages = Array.from(usageById.values());
  return {
    mostUsed: usages
      .filter((usage) => usage.userCount > 0)
      .sort((first, second) => second.userCount - first.userCount || first.id.localeCompare(second.id)),
    unusedIds: usages
      .filter((usage) => usage.userCount === 0 && !usedByFunctions.has(usage.id))
      .map((usage) => usage.id)
      .sort((first, second) => first.localeCompare(second)),
  };
}

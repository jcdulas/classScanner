// The "uses" graph of the classes, for the analysis panel (spec §4.9): who uses
// whom, with one link per pair of classes, and the shortest chain of uses from
// a class to another one.
//
// A class uses another one when it derives from it, holds it in an attribute
// (composition, aggregation), names it in a method (dependency) or calls one
// of its methods. The other relation kinds are left out on purpose:
//   - an include is a relation between two files, which the kinds above
//     already tell class by class;
//   - a nested class and its outer class always know each other, and a friend
//     declaration is a permission, not a use: both would report cycles that
//     say nothing about the design.
// Every link counts whether its relation kind is displayed or not, and whether
// a filter hides its classes or not, like the interface of a selection.

import { Graph, RelationKind } from '../../shared/graphModel';
import { InterfaceUse } from './selectionInterface';

export const USAGE_RELATION_KINDS: RelationKind[] = ['inherit', 'compose', 'aggregate', 'depend'];

/** `from` uses `to`. The ends are classes, or groups of classes (groupUsageLinks). */
export interface UsageLink {
  from: string;
  to: string;
  /** The first use found between the two, which explains the link: a click opens its line. */
  firstUse: InterfaceUse;
  /** Number of uses that the link stands for: declarations of relations, and calls. */
  useCount: number;
}

/** One link per pair of classes where the first uses the second. */
export function collectUsageLinks(graph: Graph): UsageLink[] {
  const links = new LinkCollector();
  for (const edge of graph.edges) {
    if (!USAGE_RELATION_KINDS.includes(edge.kind)) {
      continue;
    }
    for (const declaration of edge.declarations) {
      links.add(edge.from, edge.to, {
        kind: edge.kind,
        userId: edge.from,
        userMember: declaration.member,
        file: declaration.file,
        line: declaration.line,
      });
    }
  }
  for (const call of graph.calls) {
    links.add(call.from, call.to, {
      kind: 'call',
      userId: call.from,
      userMember: call.fromMethod,
      calledMethod: call.method,
      file: call.file,
      line: call.line,
    });
  }
  return links.toLinks();
}

/**
 * The links between groups of classes: one per pair of groups where a class of the first uses
 * a class of the second. `groupKeyByClass` gives the group of each class; uses inside a group
 * are left out.
 */
export function groupUsageLinks(classLinks: UsageLink[], groupKeyByClass: Map<string, string>): UsageLink[] {
  const links = new LinkCollector();
  for (const link of classLinks) {
    const fromGroup = groupKeyByClass.get(link.from);
    const toGroup = groupKeyByClass.get(link.to);
    if (fromGroup !== undefined && toGroup !== undefined) {
      links.add(fromGroup, toGroup, link.firstUse, link.useCount);
    }
  }
  return links.toLinks();
}

/** The links that leave each end, to walk the graph. */
export function linksByUser(links: UsageLink[]): Map<string, UsageLink[]> {
  const byUser = new Map<string, UsageLink[]>();
  for (const link of links) {
    const list = byUser.get(link.from) ?? [];
    list.push(link);
    byUser.set(link.from, list);
  }
  return byUser;
}

/**
 * The shortest chain of links that goes from `fromId` to `toId`, or undefined when there is
 * none. With `fromId` equal to `toId`, it is the shortest cycle through that class. `within`
 * restricts the chain to some classes.
 *
 * This is a breadth-first search: classes are visited by increasing distance from `fromId`,
 * so the first link that reaches `toId` ends a shortest chain.
 */
export function shortestUsagePath(
  successors: Map<string, UsageLink[]>,
  fromId: string,
  toId: string,
  within?: Set<string>,
): UsageLink[] | undefined {
  // For each class reached, the link that reached it first.
  const linkTo = new Map<string, UsageLink>();
  const visited = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const link of successors.get(id) ?? []) {
        if (link.to === toId) {
          return [...chainTo(id, fromId, linkTo), link];
        }
        if (!visited.has(link.to) && (within === undefined || within.has(link.to))) {
          visited.add(link.to);
          linkTo.set(link.to, link);
          nextFrontier.push(link.to);
        }
      }
    }
    frontier = nextFrontier;
  }
  return undefined;
}

/** The links followed from `fromId` to `id`, in order. */
function chainTo(id: string, fromId: string, linkTo: Map<string, UsageLink>): UsageLink[] {
  const chain: UsageLink[] = [];
  let current = id;
  while (current !== fromId) {
    const link = linkTo.get(current)!;
    chain.unshift(link);
    current = link.from;
  }
  return chain;
}

/** Merges the uses between the same two ends into one link. */
class LinkCollector {
  private readonly linksByKey = new Map<string, UsageLink>();

  add(from: string, to: string, use: InterfaceUse, useCount = 1): void {
    if (from === to) {
      return;
    }
    const key = `${from}\n${to}`;
    const link = this.linksByKey.get(key);
    if (link === undefined) {
      this.linksByKey.set(key, { from, to, firstUse: use, useCount });
    } else {
      link.useCount += useCount;
    }
  }

  toLinks(): UsageLink[] {
    return Array.from(this.linksByKey.values());
  }
}

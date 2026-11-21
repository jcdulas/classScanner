// Everything the analysis panel shows about who uses whom (spec §4.9), computed
// once per graph and grouping: the links, their cycles between classes and
// between groups, and the ranking of the classes.

import { Graph } from '../../shared/graphModel';
import { UsageCycle, findUsageCycles } from './usageCycles';
import { UsageLink, collectUsageLinks, groupUsageLinks, linksByUser, shortestUsagePath } from './usageLinks';
import { UsageRanking, rankClassUsage } from './usageRanking';

export interface UsageAnalysis {
  /** One link per pair of classes where the first uses the second. */
  links: UsageLink[];
  /** The links that leave each class. */
  successors: Map<string, UsageLink[]>;
  classCycles: UsageCycle[];
  /** Cycles between the groups of the current grouping: namespaces, folders or files. */
  groupCycles: UsageCycle[];
  ranking: UsageRanking;
}

/** `groupKeyByClass` gives the group of each class in the current grouping. */
export function analyzeUsage(graph: Graph, groupKeyByClass: Map<string, string>): UsageAnalysis {
  const links = collectUsageLinks(graph);
  return {
    links,
    successors: linksByUser(links),
    classCycles: findUsageCycles(links),
    groupCycles: findUsageCycles(groupUsageLinks(links, groupKeyByClass)),
    ranking: rankClassUsage(graph, links),
  };
}

/** The shortest chain of uses from a class to another one, or undefined when the first does not reach the second. */
export function findUsagePath(analysis: UsageAnalysis, fromId: string, toId: string): UsageLink[] | undefined {
  return fromId === toId ? undefined : shortestUsagePath(analysis.successors, fromId, toId);
}

/** The classes along a chain of links, in order, each once. */
export function classesAlong(path: UsageLink[]): string[] {
  const ids = path.length === 0 ? [] : [path[0].from];
  for (const link of path) {
    if (!ids.includes(link.to)) {
      ids.push(link.to);
    }
  }
  return ids;
}

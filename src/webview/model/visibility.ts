// Decides which classes are shown, from the filters and the isolation mode (spec §4.6).

import { ClassNode, Edge, Graph, RelationKind, isTemplate } from '../../shared/graphModel';
import { DiagramFilters } from '../../shared/savedState';
import { folderOf } from './groups';

export interface IsolationState {
  nodeId: string;
  depth: number;
}

export function computeVisibleNodeIds(
  graph: Graph,
  filters: DiagramFilters,
  isolation: IsolationState | null,
  activeRelations: Set<RelationKind>,
): Set<string> {
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    if (passesFilters(node, filters, graph.files)) {
      visible.add(node.id);
    }
  }
  if (isolation === null) {
    return visible;
  }
  const neighborhood = findNeighborhood(isolation.nodeId, isolation.depth, graph.edges, activeRelations);
  return new Set(Array.from(visible).filter((id) => neighborhood.has(id)));
}

function passesFilters(node: ClassNode, filters: DiagramFilters, files: string[]): boolean {
  if (node.isExternal && !filters.showExternal) {
    return false;
  }
  if (filters.hiddenEntityKinds.includes(node.kind)) {
    return false;
  }
  if (filters.hiddenEntityKinds.includes('template') && isTemplate(node)) {
    return false;
  }
  if (filters.hiddenNamespaces.includes(node.namespace)) {
    return false;
  }
  const folder = folderOf(files[node.file] ?? '');
  return !filters.hiddenFolders.includes(folder);
}

/**
 * The classes reachable from `startId` in at most `depth` steps, following
 * the active relations in both directions. Includes `startId` itself.
 */
export function findNeighborhood(
  startId: string,
  depth: number,
  edges: Edge[],
  activeRelations: Set<RelationKind>,
): Set<string> {
  const neighbors = buildNeighborMap(edges, activeRelations);
  const reached = new Set<string>([startId]);
  let frontier = [startId];
  for (let step = 0; step < depth; step++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const neighbor of neighbors.get(id) ?? []) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }
  return reached;
}

function buildNeighborMap(edges: Edge[], activeRelations: Set<RelationKind>): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = neighbors.get(from) ?? [];
    list.push(to);
    neighbors.set(from, list);
  };
  for (const edge of edges) {
    if (activeRelations.has(edge.kind)) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }
  }
  return neighbors;
}

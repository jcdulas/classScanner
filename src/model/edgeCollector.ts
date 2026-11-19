// Collects the edges of the graph and applies the deduplication rules of spec §3.
//
//   - Edges of the same kind between the same two classes are kept once.
//     For composition and aggregation, a `*` multiplicity wins over `1`.
//   - Edges from a class to itself are dropped (a linked-list node pointing to
//     the next node, for example): they would only clutter the diagram.
//   - A dependency from A to B is dropped when A already inherits from,
//     composes or aggregates B, since those relations imply the dependency.

import { Edge, RelationKind, Visibility } from '../shared/graphModel';

const RELATIONS_THAT_IMPLY_DEPENDENCY: RelationKind[] = ['inherit', 'compose', 'aggregate'];

export class EdgeCollector {
  private readonly edgesByKey = new Map<string, Edge>();

  add(from: string, to: string, kind: RelationKind, details: { access?: Visibility; multiplicity?: '1' | '*' } = {}): void {
    if (from === to) {
      return;
    }
    const key = edgeKey(from, to, kind);
    const existing = this.edgesByKey.get(key);
    if (existing === undefined) {
      this.edgesByKey.set(key, { from, to, kind, ...details });
    } else if (details.multiplicity === '*') {
      existing.multiplicity = '*';
    }
  }

  /** The final list of edges, in a stable order. */
  toEdges(): Edge[] {
    const edges: Edge[] = [];
    for (const edge of this.edgesByKey.values()) {
      if (edge.kind === 'depend' && this.hasStrongerRelation(edge.from, edge.to)) {
        continue;
      }
      edges.push(edge);
    }
    return edges;
  }

  private hasStrongerRelation(from: string, to: string): boolean {
    return RELATIONS_THAT_IMPLY_DEPENDENCY.some((kind) => this.edgesByKey.has(edgeKey(from, to, kind)));
  }
}

function edgeKey(from: string, to: string, kind: RelationKind): string {
  return `${kind}|${from}|${to}`;
}

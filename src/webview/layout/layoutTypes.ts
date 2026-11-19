// Inputs and outputs of the layout computation, exchanged with the layout web worker.

import { RelationKind } from '../../shared/graphModel';
import { LayoutKind, Point } from '../../shared/savedState';

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
  /** Group key; only used by the grouped layout. */
  group: string;
}

export interface LayoutEdgeInput {
  from: string;
  to: string;
  kind: RelationKind;
}

export interface LayoutInput {
  kind: LayoutKind;
  nodes: LayoutNodeInput[];
  /** Only the structural relations (setting classScanner.structuralRelations). */
  edges: LayoutEdgeInput[];
  /** Every relation of the graph, of any kind: used to place related groups close together. */
  affinityEdges: { from: string; to: string }[];
}

/** A request to place group boxes next to each other without moving the cards inside them. */
export interface PackingInput {
  boxes: { id: string; width: number; height: number }[];
  /** Number of relations between the classes of two groups. */
  links: { from: string; to: string; weight: number }[];
}

/** Top-left corner of each card. */
export type LayoutPositions = Record<string, Point>;

export type LayoutRequestMessage = { requestId: number; input: LayoutInput } | { requestId: number; packing: PackingInput };

export type LayoutResponseMessage =
  | { requestId: number; positions: LayoutPositions; durationMs: number }
  | { requestId: number; error: string };

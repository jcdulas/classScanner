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
}

/** Top-left corner of each card. */
export type LayoutPositions = Record<string, Point>;

export interface LayoutRequestMessage {
  requestId: number;
  input: LayoutInput;
}

export type LayoutResponseMessage =
  | { requestId: number; positions: LayoutPositions; durationMs: number }
  | { requestId: number; error: string };

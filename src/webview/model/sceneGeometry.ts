// Computes what the diagram shows, independently of how it is drawn: group
// boxes, card rectangles and the list of edges to draw (spec §4.4, §4.5).
// The WebGL renderer and the SVG export both use it, so they always agree.
//
// Edge merging: when a group is collapsed, or when the whole diagram is seen
// from far away (overview level), the edges between two groups are replaced
// by a single "aggregated" link whose thickness reflects how many relations
// it stands for.

import { Edge, RelationKind } from '../../shared/graphModel';
import { DiagramStore, LevelOfDetail } from '../state/diagramStore';
import { Rect, rectsOverlap, unionOfRects } from './geometry';
import { GROUP_STYLE, groupLabel } from './groups';

export interface GroupBox {
  key: string;
  label: string;
  /** Frame around the visible member cards, title band included. */
  rect: Rect;
  isCollapsed: boolean;
  /** The single card shown instead of the members when the group is collapsed. */
  collapsedRect: Rect;
  memberIds: string[];
}

export interface IndividualEdge {
  edge: Edge;
  source: Rect;
  target: Rect;
}

export interface AggregatedLink {
  sourceKey: string;
  targetKey: string;
  source: Rect;
  target: Rect;
  countsByKind: Partial<Record<RelationKind, number>>;
  total: number;
}

export interface DisplayedEdges {
  individual: IndividualEdge[];
  aggregated: AggregatedLink[];
}

export function cardRect(store: DiagramStore, id: string): Rect | undefined {
  const position = store.positions.get(id);
  const card = store.cardLayouts.get(id);
  if (position === undefined || card === undefined) {
    return undefined;
  }
  return { x: position.x, y: position.y, width: card.width, height: card.height };
}

/** Group boxes of the visible classes. Empty when the current layout has no group boxes. */
export function computeGroupBoxes(store: DiagramStore): Map<string, GroupBox> {
  const boxes = new Map<string, GroupBox>();
  if (!store.hasGroupBoxes) {
    return boxes;
  }
  const membersByGroup = new Map<string, string[]>();
  for (const id of store.visibleNodeIds) {
    const key = store.groupKeyByNode.get(id) ?? '';
    const members = membersByGroup.get(key) ?? [];
    members.push(id);
    membersByGroup.set(key, members);
  }
  for (const [key, memberIds] of membersByGroup) {
    const bounds = unionOfRects(memberIds.flatMap((id) => cardRect(store, id) ?? []));
    if (bounds === undefined) {
      continue;
    }
    const rect: Rect = {
      x: bounds.x - GROUP_STYLE.padding,
      y: bounds.y - GROUP_STYLE.padding - GROUP_STYLE.titleHeight,
      width: bounds.width + GROUP_STYLE.padding * 2,
      height: bounds.height + GROUP_STYLE.padding * 2 + GROUP_STYLE.titleHeight,
    };
    boxes.set(key, {
      key,
      label: groupLabel(key, store.grouping),
      rect,
      isCollapsed: store.collapsedGroups.has(key),
      collapsedRect: { x: rect.x, y: rect.y, width: GROUP_STYLE.collapsedWidth, height: GROUP_STYLE.collapsedHeight },
      memberIds,
    });
  }
  return boxes;
}

/** True when the card is drawn: visible, and not hidden inside a collapsed group. */
export function isCardShown(store: DiagramStore, groupBoxes: Map<string, GroupBox>, id: string): boolean {
  if (!store.visibleNodeIds.has(id)) {
    return false;
  }
  const group = groupBoxes.get(store.groupKeyByNode.get(id) ?? '');
  return group === undefined || !group.isCollapsed;
}

/**
 * The edges to draw for the active relations. When `cullRect` is given, edges
 * whose two ends are outside of it are skipped (spec §4.5).
 */
export function computeDisplayedEdges(
  store: DiagramStore,
  groupBoxes: Map<string, GroupBox>,
  level: LevelOfDetail,
  cullRect?: Rect,
): DisplayedEdges {
  const individual: IndividualEdge[] = [];
  const aggregatedByPair = new Map<string, AggregatedLink>();
  const mergeAllGroups = level === 'overview' && groupBoxes.size > 0;

  // Where each end of an edge is drawn: on the card itself, or on its group.
  const endpointOf = (id: string): { key: string; rect: Rect; isGroup: boolean } | undefined => {
    if (!store.visibleNodeIds.has(id)) {
      return undefined;
    }
    const groupKey = store.groupKeyByNode.get(id) ?? '';
    const group = groupBoxes.get(groupKey);
    if (group !== undefined && (group.isCollapsed || mergeAllGroups)) {
      return { key: `group:${groupKey}`, rect: group.isCollapsed ? group.collapsedRect : group.rect, isGroup: true };
    }
    const rect = cardRect(store, id);
    return rect === undefined ? undefined : { key: id, rect, isGroup: false };
  };

  for (const edge of store.graph?.edges ?? []) {
    if (!store.activeRelations.has(edge.kind)) {
      continue;
    }
    const source = endpointOf(edge.from);
    const target = endpointOf(edge.to);
    if (source === undefined || target === undefined || source.key === target.key) {
      continue;
    }
    if (cullRect !== undefined && !rectsOverlap(source.rect, cullRect) && !rectsOverlap(target.rect, cullRect)) {
      continue;
    }
    if (!source.isGroup && !target.isGroup) {
      individual.push({ edge, source: source.rect, target: target.rect });
      continue;
    }
    // The direction does not matter for an aggregated link: A->B and B->A are merged.
    const pairKey = source.key < target.key ? `${source.key}|${target.key}` : `${target.key}|${source.key}`;
    let link = aggregatedByPair.get(pairKey);
    if (link === undefined) {
      link = { sourceKey: source.key, targetKey: target.key, source: source.rect, target: target.rect, countsByKind: {}, total: 0 };
      aggregatedByPair.set(pairKey, link);
    }
    link.countsByKind[edge.kind] = (link.countsByKind[edge.kind] ?? 0) + 1;
    link.total++;
  }
  return { individual, aggregated: Array.from(aggregatedByPair.values()) };
}

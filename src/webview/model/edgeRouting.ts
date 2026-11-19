// Computes the path of each edge between two cards (spec §4.5).
//
// Two styles exist:
//   - `straight`: one segment between the borders of the two cards. Used by the
//     organic layout, where cards are placed in every direction.
//   - `orthogonal`: horizontal and vertical segments only, as in a classic UML
//     diagram. An edge leaves a card through the side that faces the other card,
//     goes halfway, turns, and enters the other card through the facing side.
//
// In the orthogonal style, the edges that use the same side of a card are spread
// along that side ("ports") instead of all starting from its middle, and they
// are ordered like the cards they lead to, which avoids needless crossings.
// Inheritance is the exception on the base class side: all the derived classes
// arrive at the middle of the base class, so that they share one arrow head and
// form the usual tree.
//
// Paths are computed for one relation kind at a time, so that turning a kind on
// or off does not move the edges of the other kinds. Each kind is shifted by a
// few units (its "lane") so that edges of different kinds do not hide each other.

import { ALL_RELATION_KINDS, Edge, RelationKind } from '../../shared/graphModel';
import { LayoutKind, Point } from '../../shared/savedState';
import { edgeSegment } from './edgeGeometry';
import { Rect } from './geometry';
import { IndividualEdge } from './sceneGeometry';

export type RoutingStyle = 'straight' | 'orthogonal';

/** The organic layout places cards in every direction, where straight edges read better. */
export function routingStyleForLayout(layout: LayoutKind): RoutingStyle {
  return layout === 'organic' ? 'straight' : 'orthogonal';
}

export interface RoutedEdge {
  edge: Edge;
  /** The path, from the border of the `from` card to the border of the `to` card. */
  points: Point[];
}

type Side = 'top' | 'bottom' | 'left' | 'right';

/** Cards closer than this, along an axis, are linked by a straight segment instead of an elbow. */
const MINIMUM_GAP = 16;
const PORT_SPACING = 12;
/** Ports stay this far from the corners of a card. */
const CORNER_MARGIN = 10;
const LANE_WIDTH = 3;

interface PlannedEdge {
  item: IndividualEdge;
  /** Undefined when the two cards are too close for an elbow: the edge is drawn straight. */
  sides?: { source: Side; target: Side };
  sourceOffset: number;
  targetOffset: number;
}

/** Routes edges that are all of the same relation kind. */
export function routeEdges(edges: IndividualEdge[], kind: RelationKind, style: RoutingStyle): RoutedEdge[] {
  if (style === 'straight') {
    return edges.map((item) => {
      const segment = edgeSegment(item.source, item.target);
      return { edge: item.edge, points: [segment.start, segment.end] };
    });
  }
  const planned: PlannedEdge[] = edges.map((item) => ({ item, sides: chooseSides(item.source, item.target), sourceOffset: 0, targetOffset: 0 }));
  assignPorts(planned, kind);
  const lane = laneShift(kind);
  return planned.map((plan) => ({ edge: plan.item.edge, points: buildPath(plan, lane) }));
}

/** The sides through which an edge leaves its source card and enters its target card. */
function chooseSides(source: Rect, target: Rect): { source: Side; target: Side } | undefined {
  if (target.y >= source.y + source.height + MINIMUM_GAP) {
    return { source: 'bottom', target: 'top' };
  }
  if (target.y + target.height + MINIMUM_GAP <= source.y) {
    return { source: 'top', target: 'bottom' };
  }
  if (target.x >= source.x + source.width + MINIMUM_GAP) {
    return { source: 'right', target: 'left' };
  }
  if (target.x + target.width + MINIMUM_GAP <= source.x) {
    return { source: 'left', target: 'right' };
  }
  return undefined;
}

/** Spreads the edge ends that share a side of a card along that side. */
function assignPorts(planned: PlannedEdge[], kind: RelationKind): void {
  interface PortUser {
    plan: PlannedEdge;
    end: 'source' | 'target';
    /** Position of the card at the other end, along the side: ports are ordered by it. */
    otherPosition: number;
    sideLength: number;
  }
  const usersBySide = new Map<string, PortUser[]>();
  const register = (cardId: string, side: Side, user: PortUser) => {
    const key = `${cardId}|${side}`;
    const users = usersBySide.get(key) ?? [];
    users.push(user);
    usersBySide.set(key, users);
  };

  for (const plan of planned) {
    if (plan.sides === undefined) {
      continue;
    }
    const { source, target } = plan.item;
    const isVertical = plan.sides.source === 'top' || plan.sides.source === 'bottom';
    const centerAlongSide = (rect: Rect) => (isVertical ? rect.x + rect.width / 2 : rect.y + rect.height / 2);
    const lengthAlongSide = (rect: Rect) => (isVertical ? rect.width : rect.height);
    register(plan.item.edge.from, plan.sides.source, {
      plan,
      end: 'source',
      otherPosition: centerAlongSide(target),
      sideLength: lengthAlongSide(source),
    });
    // The derived classes of a base class all arrive at its middle, to share one arrow head.
    if (kind !== 'inherit') {
      register(plan.item.edge.to, plan.sides.target, {
        plan,
        end: 'target',
        otherPosition: centerAlongSide(source),
        sideLength: lengthAlongSide(target),
      });
    }
  }

  for (const users of usersBySide.values()) {
    users.sort((first, second) => first.otherPosition - second.otherPosition);
    const available = Math.max(0, users[0].sideLength - CORNER_MARGIN * 2);
    const spacing = users.length > 1 ? Math.min(PORT_SPACING, available / (users.length - 1)) : 0;
    users.forEach((user, index) => {
      const offset = (index - (users.length - 1) / 2) * spacing;
      if (user.end === 'source') {
        user.plan.sourceOffset = offset;
      } else {
        user.plan.targetOffset = offset;
      }
    });
  }
}

/** A small shift per relation kind, so that edges of different kinds do not hide each other. */
function laneShift(kind: RelationKind): number {
  if (kind === 'inherit') {
    return 0;
  }
  return (ALL_RELATION_KINDS.indexOf(kind) - ALL_RELATION_KINDS.length / 2) * LANE_WIDTH;
}

function buildPath(plan: PlannedEdge, lane: number): Point[] {
  const { source, target } = plan.item;
  if (plan.sides === undefined) {
    const segment = edgeSegment(source, target);
    return [segment.start, segment.end];
  }
  const start = pointOnSide(source, plan.sides.source, plan.sourceOffset + lane);
  const end = pointOnSide(target, plan.sides.target, plan.targetOffset + lane);
  const isVertical = plan.sides.source === 'top' || plan.sides.source === 'bottom';
  if (isVertical) {
    if (Math.abs(start.x - end.x) < 0.5) {
      return [start, end];
    }
    const middleY = (start.y + end.y) / 2 + lane;
    return [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
  }
  if (Math.abs(start.y - end.y) < 0.5) {
    return [start, end];
  }
  const middleX = (start.x + end.x) / 2 + lane;
  return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
}

/** The point of a side at `offset` from its middle, kept away from the corners. */
function pointOnSide(rect: Rect, side: Side, offset: number): Point {
  const isHorizontalSide = side === 'top' || side === 'bottom';
  const halfLength = (isHorizontalSide ? rect.width : rect.height) / 2;
  const limit = Math.max(0, halfLength - CORNER_MARGIN);
  const clampedOffset = Math.max(-limit, Math.min(limit, offset));
  switch (side) {
    case 'top':
      return { x: rect.x + halfLength + clampedOffset, y: rect.y };
    case 'bottom':
      return { x: rect.x + halfLength + clampedOffset, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + halfLength + clampedOffset };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + halfLength + clampedOffset };
  }
}

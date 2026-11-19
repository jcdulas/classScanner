// The shape of an edge: where it starts and ends on the card borders, and the
// UML decoration at its end (spec §3, notation column).
//
//   inheritance  solid line,  hollow triangle on the base class
//   composition  solid line,  filled diamond on the whole (the owner)
//   aggregation  solid line,  hollow diamond on the whole
//   dependency   dashed line, open arrow on the used class
//   include      dotted line, open arrow on the included class
//   friend       dashed line, open arrow on the friend
//   nesting      solid line,  circled plus on the outer class

import { RelationKind } from '../../shared/graphModel';
import { Point } from '../../shared/savedState';
import { Rect, rectCenter } from './geometry';

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type Decoration = 'hollowTriangle' | 'filledDiamond' | 'hollowDiamond' | 'openArrow' | 'circledPlus';

export interface EdgeStyle {
  line: LineStyle;
  /** Line width in screen pixels. */
  width: number;
  decoration: Decoration;
  /** True when the decoration is drawn at the source end (the `from` class) instead of the target end. */
  decorationAtSource: boolean;
}

export const EDGE_STYLES: Record<RelationKind, EdgeStyle> = {
  inherit: { line: 'solid', width: 1.1, decoration: 'hollowTriangle', decorationAtSource: false },
  compose: { line: 'solid', width: 1, decoration: 'filledDiamond', decorationAtSource: true },
  aggregate: { line: 'solid', width: 1, decoration: 'hollowDiamond', decorationAtSource: true },
  depend: { line: 'dashed', width: 0.9, decoration: 'openArrow', decorationAtSource: false },
  include: { line: 'dotted', width: 0.8, decoration: 'openArrow', decorationAtSource: false },
  friend: { line: 'dashed', width: 0.9, decoration: 'openArrow', decorationAtSource: false },
  nest: { line: 'solid', width: 0.9, decoration: 'circledPlus', decorationAtSource: true },
};

/** Dash and gap lengths in screen pixels. */
export const DASH_PATTERNS: Record<LineStyle, [number, number] | undefined> = {
  solid: undefined,
  dashed: [5, 3],
  dotted: [1.5, 3],
};

/**
 * Width in screen pixels of a merged link between two groups (spec §4.5). It grows with the
 * logarithm of the number of relations: 1 relation is thin, 1000 are not 1000 times thicker.
 */
export function aggregatedLinkWidth(relationCount: number): number {
  return Math.min(5, 0.9 + 0.6 * Math.log2(relationCount));
}

/** Length of an arrow head or diamond, in screen pixels. */
const DECORATION_SCREEN_SIZE = 7;
/** Decorations never get larger than this in diagram units, so they stay smaller than the cards. */
const DECORATION_MAX_WORLD_SIZE = 12;

/**
 * Size of the decorations in diagram units for a zoom level. Up close they keep a constant
 * size on screen; far away they shrink with the cards instead of covering them.
 */
export function decorationSizeForScale(scale: number): number {
  return Math.min(DECORATION_SCREEN_SIZE / scale, DECORATION_MAX_WORLD_SIZE);
}

export interface Segment {
  start: Point;
  end: Point;
}

/** The straight line between two cards, clipped to their borders. */
export function edgeSegment(source: Rect, target: Rect): Segment {
  const sourceCenter = rectCenter(source);
  const targetCenter = rectCenter(target);
  return {
    start: clipToRectBorder(sourceCenter, targetCenter, source),
    end: clipToRectBorder(targetCenter, sourceCenter, target),
  };
}

/** The point where the segment from `inside` (the center of `rect`) toward `outside` leaves `rect`. */
function clipToRectBorder(inside: Point, outside: Point, rect: Rect): Point {
  const deltaX = outside.x - inside.x;
  const deltaY = outside.y - inside.y;
  if (deltaX === 0 && deltaY === 0) {
    return inside;
  }
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  // The segment leaves through the side it reaches first.
  const scaleX = deltaX === 0 ? Infinity : halfWidth / Math.abs(deltaX);
  const scaleY = deltaY === 0 ? Infinity : halfHeight / Math.abs(deltaY);
  const scale = Math.min(scaleX, scaleY, 1);
  return { x: inside.x + deltaX * scale, y: inside.y + deltaY * scale };
}

/**
 * The polygon of a decoration (in world coordinates), with its tip on `tip`
 * and pointing in the direction going from `from` to `tip`.
 * `size` is the length of the decoration in world units.
 */
export function decorationPolygon(decoration: Decoration, from: Point, tip: Point, size: number): number[] {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  // Unit vector along the edge, and the perpendicular vector.
  const alongX = (tip.x - from.x) / length;
  const alongY = (tip.y - from.y) / length;
  const acrossX = -alongY;
  const acrossY = alongX;
  const point = (along: number, across: number) => [
    tip.x - alongX * along + acrossX * across,
    tip.y - alongY * along + acrossY * across,
  ];
  switch (decoration) {
    case 'hollowTriangle':
      return [...point(0, 0), ...point(size, size * 0.6), ...point(size, -size * 0.6)];
    case 'filledDiamond':
    case 'hollowDiamond':
      return [...point(0, 0), ...point(size * 0.8, size * 0.45), ...point(size * 1.6, 0), ...point(size * 0.8, -size * 0.45)];
    case 'openArrow':
      // Three points of an open "V": drawn as two lines, not filled.
      return [...point(size, size * 0.55), ...point(0, 0), ...point(size, -size * 0.55)];
    case 'circledPlus':
      return [...point(size * 0.6, 0)];
  }
}

/** Where the line must stop so that it does not cross a closed decoration. */
export function lineEndBeforeDecoration(decoration: Decoration, from: Point, tip: Point, size: number): Point {
  const backOff: Record<Decoration, number> = {
    hollowTriangle: size,
    filledDiamond: size * 1.6,
    hollowDiamond: size * 1.6,
    openArrow: 0,
    circledPlus: size * 1.2,
  };
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const distance = Math.min(backOff[decoration], length);
  return { x: tip.x - ((tip.x - from.x) / length) * distance, y: tip.y - ((tip.y - from.y) / length) * distance };
}

/**
 * The part of a segment inside a rectangle, or undefined when the segment misses it
 * (Liang-Barsky algorithm: the segment is written start + t * (end - start), and each
 * side of the rectangle narrows the range of t that stays inside).
 */
export function clipSegmentToRect(segment: Segment, rect: Rect): Segment | undefined {
  const deltaX = segment.end.x - segment.start.x;
  const deltaY = segment.end.y - segment.start.y;
  let tMin = 0;
  let tMax = 1;
  const sides: [number, number][] = [
    [-deltaX, segment.start.x - rect.x],
    [deltaX, rect.x + rect.width - segment.start.x],
    [-deltaY, segment.start.y - rect.y],
    [deltaY, rect.y + rect.height - segment.start.y],
  ];
  for (const [direction, distance] of sides) {
    if (direction === 0) {
      if (distance < 0) {
        return undefined; // Parallel to this side and outside of it.
      }
      continue;
    }
    const t = distance / direction;
    if (direction < 0) {
      tMin = Math.max(tMin, t);
    } else {
      tMax = Math.min(tMax, t);
    }
    if (tMin > tMax) {
      return undefined;
    }
  }
  return {
    start: { x: segment.start.x + deltaX * tMin, y: segment.start.y + deltaY * tMin },
    end: { x: segment.start.x + deltaX * tMax, y: segment.start.y + deltaY * tMax },
  };
}

/**
 * Splits a segment into dashes. `dash` and `gap` are in world units.
 * The number of dashes is capped so that a very long edge cannot produce millions of pieces.
 */
export function dashSegments(segment: Segment, dash: number, gap: number): Segment[] {
  const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
  const period = dash + gap;
  if (length === 0 || period <= 0) {
    return [];
  }
  const maxDashes = 400;
  const scale = length / period > maxDashes ? length / (period * maxDashes) : 1;
  const unitX = (segment.end.x - segment.start.x) / length;
  const unitY = (segment.end.y - segment.start.y) / length;
  const dashes: Segment[] = [];
  for (let offset = 0; offset < length; offset += period * scale) {
    const dashEnd = Math.min(offset + dash * scale, length);
    dashes.push({
      start: { x: segment.start.x + unitX * offset, y: segment.start.y + unitY * offset },
      end: { x: segment.start.x + unitX * dashEnd, y: segment.start.y + unitY * dashEnd },
    });
  }
  return dashes;
}

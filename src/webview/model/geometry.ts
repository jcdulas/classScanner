// Basic 2D geometry used by the layout, the renderer and the export.
// All coordinates are "world" coordinates: the coordinates of the diagram
// before the camera's pan and zoom are applied.

import { Point } from '../../shared/savedState';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectsOverlap(first: Rect, second: Rect, margin = 0): boolean {
  return (
    first.x < second.x + second.width + margin &&
    second.x < first.x + first.width + margin &&
    first.y < second.y + second.height + margin &&
    second.y < first.y + first.height + margin
  );
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** The smallest rectangle containing all the given rectangles, or undefined for an empty list. */
export function unionOfRects(rects: Iterable<Rect>): Rect | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (minX === Infinity) {
    return undefined;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function expandRect(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

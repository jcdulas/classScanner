// Finds the edge under the pointer, to open the declaration of its relation
// (spec §4.6).
//
// An edge is a thin line, about one pixel wide: the pointer is "on" it when it
// is within a few pixels of one of the segments of its path. Rounded corners
// are ignored: they stay within a few diagram units of the path.
//
// Every routed edge is checked, without a spatial index: it is simple, and fast
// enough. Measured on 24,000 edges of three segments each, which is the
// synthetic project with every relation kind active and the whole diagram in
// view: 3 ms per search, done at most once per frame of 16 ms while the
// pointer moves.

import { Point } from '../../shared/savedState';
import { RoutedEdge } from './edgeRouting';

export interface NearestRoute {
  route: RoutedEdge;
  distance: number;
}

/** The route closest to `point` among those within `tolerance` of it (in diagram units), if any. */
export function nearestRouteWithin(routes: RoutedEdge[], point: Point, tolerance: number): NearestRoute | undefined {
  let nearest: NearestRoute | undefined;
  for (const route of routes) {
    const distance = distanceToPath(point, route.points);
    if (distance <= tolerance && (nearest === undefined || distance < nearest.distance)) {
      nearest = { route, distance };
    }
  }
  return nearest;
}

/** Distance from a point to a path made of straight segments. */
export function distanceToPath(point: Point, path: Point[]): number {
  let smallest = Infinity;
  for (let index = 0; index + 1 < path.length; index++) {
    smallest = Math.min(smallest, distanceToSegment(point, path[index], path[index + 1]));
  }
  return smallest;
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  // `t` is the position, between 0 (start) and 1 (end), of the point of the segment closest to `point`.
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * (end.x - start.x)), point.y - (start.y + t * (end.y - start.y)));
}

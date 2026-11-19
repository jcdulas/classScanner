// Finds quickly which items are in a rectangle or under a point (spec §4.1).
//
// Checking 1500 rectangles one by one on every mouse move or camera move
// would be wasteful. Flatbush builds an R-tree, a tree of nested bounding
// boxes, so that a search only visits the branches that overlap the query.
// The index is static: it is rebuilt whenever positions or visibility change,
// which takes about a millisecond for a few thousand items.

import Flatbush from 'flatbush';
import { Point } from '../../shared/savedState';
import { Rect } from '../model/geometry';

export type HitTarget =
  | { kind: 'card'; id: string }
  | { kind: 'collapsedGroup'; key: string }
  | { kind: 'groupTitle'; key: string };

export interface IndexedItem {
  target: HitTarget;
  rect: Rect;
  /** When items overlap, the highest priority is returned by hitTest. */
  priority: number;
}

export class SpatialIndex {
  private items: IndexedItem[] = [];
  private index: Flatbush | undefined;

  rebuild(items: IndexedItem[]): void {
    this.items = items;
    if (items.length === 0) {
      this.index = undefined;
      return;
    }
    const index = new Flatbush(items.length);
    for (const item of items) {
      index.add(item.rect.x, item.rect.y, item.rect.x + item.rect.width, item.rect.y + item.rect.height);
    }
    index.finish();
    this.index = index;
  }

  search(rect: Rect): IndexedItem[] {
    if (this.index === undefined) {
      return [];
    }
    return this.index.search(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height).map((position) => this.items[position]);
  }

  hitTest(point: Point): IndexedItem | undefined {
    const candidates = this.search({ x: point.x, y: point.y, width: 0, height: 0 });
    let best: IndexedItem | undefined;
    for (const candidate of candidates) {
      if (best === undefined || candidate.priority > best.priority) {
        best = candidate;
      }
    }
    return best;
  }
}

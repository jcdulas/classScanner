// Places classes that have no saved position yet (spec §6).
//
// After a rescan, new classes appear in an arrangement that was saved
// without them. Instead of recomputing the whole layout, which would undo
// the user's manual moves, each new class is placed in a column on the right
// of the other classes of its group.

import { Point } from '../../shared/savedState';
import { Rect, unionOfRects } from './geometry';

const GAP = 30;

export interface PlacementItem {
  id: string;
  group: string;
  width: number;
  height: number;
}

/** Returns positions for `newItems`, given the already placed `placedItems`. */
export function placeNewItems(newItems: PlacementItem[], placedItems: PlacementItem[], positions: Map<string, Point>): Map<string, Point> {
  const boundsByGroup = new Map<string, Rect>();
  for (const [group, items] of groupItems(placedItems)) {
    const bounds = unionOfRects(items.flatMap((item) => toRect(item, positions)));
    if (bounds !== undefined) {
      boundsByGroup.set(group, bounds);
    }
  }
  const allBounds = unionOfRects(boundsByGroup.values()) ?? { x: 0, y: 0, width: 0, height: 0 };

  const placed = new Map<string, Point>();
  // Next free position of the column of new items of each group.
  const columnCursor = new Map<string, Point>();
  let orphanCursor: Point = { x: allBounds.x + allBounds.width + GAP * 3, y: allBounds.y };

  for (const item of newItems) {
    const groupBounds = boundsByGroup.get(item.group);
    if (groupBounds === undefined) {
      placed.set(item.id, orphanCursor);
      orphanCursor = { x: orphanCursor.x, y: orphanCursor.y + item.height + GAP };
      continue;
    }
    const cursor = columnCursor.get(item.group) ?? { x: groupBounds.x + groupBounds.width + GAP, y: groupBounds.y };
    placed.set(item.id, cursor);
    columnCursor.set(item.group, { x: cursor.x, y: cursor.y + item.height + GAP });
  }
  return placed;
}

function groupItems(items: PlacementItem[]): Map<string, PlacementItem[]> {
  const groups = new Map<string, PlacementItem[]>();
  for (const item of items) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  return groups;
}

function toRect(item: PlacementItem, positions: Map<string, Point>): Rect[] {
  const position = positions.get(item.id);
  return position === undefined ? [] : [{ x: position.x, y: position.y, width: item.width, height: item.height }];
}

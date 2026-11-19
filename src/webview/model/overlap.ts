// Pushes cards away from a card that grew, so that cards never overlap (spec §4.3).
//
// When a card is pinned to "full", it can become taller and wider. Each card
// it now overlaps is moved just enough to clear it: down if it is below the
// top of the grown card, right otherwise. A moved card can in turn overlap
// other cards, so the moved cards are processed the same way (a cascade).

import { Point } from '../../shared/savedState';
import { Rect, rectsOverlap } from './geometry';

const GAP = 20;

export interface CardBox {
  id: string;
  width: number;
  height: number;
}

/**
 * Returns the new positions of the cards that had to move.
 * `positions` is not modified; `boxes` lists every card that can be pushed.
 */
export function pushOverlappingCards(grownIds: string[], positions: Map<string, Point>, boxes: CardBox[]): Map<string, Point> {
  const workingPositions = new Map(positions);
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const moved = new Map<string, Point>();
  const queue = [...grownIds];
  // A safety limit: the cascade always ends in theory, but a bad starting state must not freeze the page.
  let remainingSteps = boxes.length * 20;

  while (queue.length > 0 && remainingSteps > 0) {
    remainingSteps--;
    const pusherId = queue.shift()!;
    const pusher = rectOf(pusherId, workingPositions, boxById);
    if (pusher === undefined) {
      continue;
    }
    for (const box of boxes) {
      if (box.id === pusherId) {
        continue;
      }
      const other = rectOf(box.id, workingPositions, boxById);
      if (other === undefined || !rectsOverlap(pusher, other, GAP - 1)) {
        continue;
      }
      const newPosition =
        other.y >= pusher.y
          ? { x: other.x, y: pusher.y + pusher.height + GAP }
          : { x: pusher.x + pusher.width + GAP, y: other.y };
      workingPositions.set(box.id, newPosition);
      moved.set(box.id, newPosition);
      queue.push(box.id);
    }
  }
  return moved;
}

function rectOf(id: string, positions: Map<string, Point>, boxById: Map<string, CardBox>): Rect | undefined {
  const position = positions.get(id);
  const box = boxById.get(id);
  if (position === undefined || box === undefined) {
    return undefined;
  }
  return { x: position.x, y: position.y, width: box.width, height: box.height };
}

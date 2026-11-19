// Places the group boxes next to each other, with related groups close together (spec §4.4).
//
// ELK's "rectpacking" algorithm fills rows from left to right, in the order
// it is given the boxes. So the boxes are first put in an order where groups
// with many relations between them follow each other; they then end up side
// by side in a row, or in neighboring rows.

import { Point } from '../../shared/savedState';
import { Box, packBoxes } from './elkLayout';

/** Number of relations between the classes of two groups. */
export interface GroupLink {
  from: string;
  to: string;
  weight: number;
}

/** How much a group placed `n` positions earlier still attracts the next group: 0.6 to the power n. */
const AFFINITY_DECAY = 0.6;

export async function packGroups(boxes: Box[], links: GroupLink[]): Promise<Map<string, Point>> {
  return packBoxes(orderByAffinity(boxes, links));
}

/**
 * Orders the boxes so that strongly related groups follow each other. It starts with the
 * most connected group, then always adds the group most related to the groups placed last.
 * Groups without any relation come at the end, in alphabetical order.
 */
export function orderByAffinity(boxes: Box[], links: GroupLink[]): Box[] {
  const weights = new Map<string, Map<string, number>>();
  const addWeight = (from: string, to: string, weight: number) => {
    const row = weights.get(from) ?? new Map<string, number>();
    row.set(to, (row.get(to) ?? 0) + weight);
    weights.set(from, row);
  };
  for (const link of links) {
    if (link.from !== link.to) {
      addWeight(link.from, link.to, link.weight);
      addWeight(link.to, link.from, link.weight);
    }
  }
  const totalWeight = (id: string) => Array.from(weights.get(id)?.values() ?? []).reduce((total, weight) => total + weight, 0);

  const remaining = [...boxes].sort((first, second) => first.id.localeCompare(second.id));
  const ordered: Box[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    remaining.forEach((candidate, index) => {
      const score = ordered.length === 0 ? totalWeight(candidate.id) : affinityToPlaced(candidate.id, ordered, weights);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

/** The relations of a group with the groups already placed; the most recently placed count the most. */
function affinityToPlaced(id: string, placed: Box[], weights: Map<string, Map<string, number>>): number {
  const row = weights.get(id);
  if (row === undefined) {
    return 0;
  }
  let score = 0;
  let factor = 1;
  for (let index = placed.length - 1; index >= 0; index--) {
    score += (row.get(placed[index].id) ?? 0) * factor;
    factor *= AFFINITY_DECAY;
  }
  return score;
}

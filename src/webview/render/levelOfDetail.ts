// Semantic zoom (spec §4.3): what a card shows depends on the zoom level and on its display mode.
//
//   level      zoom          auto card          pinned compact     pinned full
//   overview   < 0.2         colored rectangle  colored rectangle  colored rectangle
//   compact    0.2 to 0.55   big class name     big class name     all members
//   full       >= 0.55       capped members     header only        all members
//
// At the overview level every card is a plain rectangle, whatever its mode:
// text would be unreadable there, and drawing it for 1500 cards would be slow.

import { DisplayMode } from '../../shared/savedState';
import { LevelOfDetail } from '../state/diagramStore';

export const OVERVIEW_MAX_SCALE = 0.2;
export const FULL_MIN_SCALE = 0.55;

/** What is drawn inside a card. */
export type CardContent = 'none' | 'bigName' | 'header' | 'members';

export function levelOfDetailForScale(scale: number): LevelOfDetail {
  if (scale < OVERVIEW_MAX_SCALE) {
    return 'overview';
  }
  return scale < FULL_MIN_SCALE ? 'compact' : 'full';
}

export function cardContentFor(level: LevelOfDetail, displayMode: DisplayMode): CardContent {
  if (level === 'overview') {
    return 'none';
  }
  if (displayMode === 'full') {
    return 'members';
  }
  if (level === 'compact') {
    return 'bigName';
  }
  return displayMode === 'compact' ? 'header' : 'members';
}

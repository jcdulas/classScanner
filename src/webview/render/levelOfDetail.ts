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

/**
 * What is drawn inside a card. `frame` is the card with its header band and body but no
 * text: it stands for the full card when the text would be too small to see.
 */
export type CardContent = 'none' | 'bigName' | 'frame' | 'header' | 'members';

/**
 * Below this zoom, member text is under 2 screen pixels tall and cannot be seen. Measured on
 * 1500 cards with the whole diagram in view: drawing that invisible text costs 20 frames per
 * second instead of 60 (spec §8).
 */
export const TEXT_MIN_SCALE = 0.15;

export function levelOfDetailForScale(scale: number): LevelOfDetail {
  if (scale < OVERVIEW_MAX_SCALE) {
    return 'overview';
  }
  return scale < FULL_MIN_SCALE ? 'compact' : 'full';
}

/**
 * Content of a card when the user turned the simplification off: full detail at every zoom
 * level (spec §4.3), without the text when it would be too small to see.
 */
export function unsimplifiedCardContentFor(scale: number, displayMode: DisplayMode): CardContent {
  return scale < TEXT_MIN_SCALE ? 'frame' : cardContentFor('full', displayMode);
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

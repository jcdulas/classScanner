// Measures how smoothly the diagram pans, to check the 60 frames per second target (spec §8).
//
// The probe pans the camera across the diagram at three zoom levels (one per
// level of detail) and records the time between consecutive frames. It is
// started by the integration tests through the extension host.

import { Ticker } from 'pixi.js';
import { FrameStatistics } from '../../shared/messages';
import { CameraState } from '../../shared/savedState';
import { Camera } from './camera';
import { FULL_MIN_SCALE, OVERVIEW_MAX_SCALE } from './levelOfDetail';

const FRAMES_PER_LEVEL = 120;

/**
 * Time from toggling a relation kind to the end of the frame that shows the result (spec §8:
 * under 100 ms). `toggle` changes the store; the renderer redraws on the next frame.
 */
export async function measureRelationToggle(ticker: Ticker, toggle: () => void): Promise<number> {
  const start = performance.now();
  toggle();
  await nextFrame(ticker);
  return performance.now() - start;
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Resolves after the next frame, once the renderer has processed the pending changes. */
function nextFrame(ticker: Ticker): Promise<void> {
  return new Promise((resolve) => ticker.addOnce(() => resolve()));
}

export interface ProbeLevel {
  level: string;
  scale: number;
}

/** One zoom level per level of detail. */
const DEFAULT_LEVELS: ProbeLevel[] = [
  { level: 'overview', scale: OVERVIEW_MAX_SCALE / 2 },
  { level: 'compact', scale: (OVERVIEW_MAX_SCALE + FULL_MIN_SCALE) / 2 },
  { level: 'full', scale: FULL_MIN_SCALE * 1.5 },
];

export async function measurePanningPerformance(
  camera: Camera,
  ticker: Ticker,
  onCameraMoved: () => void,
  levels: ProbeLevel[] = DEFAULT_LEVELS,
): Promise<FrameStatistics[]> {
  const initial = camera.state;
  const results: FrameStatistics[] = [];
  for (const { level, scale } of levels) {
    camera.setState({ ...initial, scale });
    onCameraMoved();
    results.push(await panAndMeasure(camera, ticker, onCameraMoved, level));
  }
  camera.setState(initial);
  onCameraMoved();
  return results;
}

function panAndMeasure(camera: Camera, ticker: Ticker, onCameraMoved: () => void, level: string): Promise<FrameStatistics> {
  return new Promise((resolve) => {
    const frameDurations: number[] = [];
    let previousTime = performance.now();
    const start: CameraState = camera.state;
    const onTick = () => {
      const now = performance.now();
      frameDurations.push(now - previousTime);
      previousTime = now;
      // Pan 8 screen pixels per frame, like a fast mouse drag.
      camera.setState({ ...start, centerX: start.centerX + (frameDurations.length * 8) / camera.scale });
      onCameraMoved();
      if (frameDurations.length >= FRAMES_PER_LEVEL) {
        ticker.remove(onTick);
        // The first frames include the switch of level of detail: they are not representative.
        const measured = frameDurations.slice(5).sort((first, second) => first - second);
        resolve({
          level,
          frameCount: measured.length,
          averageFrameMs: measured.reduce((total, value) => total + value, 0) / measured.length,
          percentile95FrameMs: measured[Math.floor(measured.length * 0.95)],
        });
      }
    };
    ticker.add(onTick);
  });
}

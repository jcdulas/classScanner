// Pan and zoom of the diagram.
//
// The whole diagram is drawn inside one PixiJS container, the "world". The
// camera moves and scales that container: `scale` is the number of screen
// pixels per world unit, and (centerX, centerY) is the world point shown at
// the center of the view. Animated moves interpolate between two camera states.

import { Container } from 'pixi.js';
import { CameraState, Point } from '../../shared/savedState';
import { Rect } from '../model/geometry';

// Low enough to show 1500+ cards at once: the reference project of spec §8 is about 40 000 units wide.
export const MIN_SCALE = 0.004;
export const MAX_SCALE = 2.5;

interface CameraAnimation {
  from: CameraState;
  to: CameraState;
  startTime: number;
  durationMs: number;
}

export class Camera {
  centerX = 0;
  centerY = 0;
  scale = 0.5;
  viewWidth = 1;
  viewHeight = 1;
  private animation: CameraAnimation | undefined;

  constructor(private readonly world: Container) {}

  get state(): CameraState {
    return { centerX: this.centerX, centerY: this.centerY, scale: this.scale };
  }

  setState(state: CameraState): void {
    this.animation = undefined;
    this.centerX = state.centerX;
    this.centerY = state.centerY;
    this.scale = clampScale(state.scale);
    this.apply();
  }

  setViewSize(width: number, height: number): void {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
    this.apply();
  }

  screenToWorld(screen: Point): Point {
    return {
      x: this.centerX + (screen.x - this.viewWidth / 2) / this.scale,
      y: this.centerY + (screen.y - this.viewHeight / 2) / this.scale,
    };
  }

  /** The part of the world currently visible on screen. */
  visibleWorldRect(): Rect {
    const width = this.viewWidth / this.scale;
    const height = this.viewHeight / this.scale;
    return { x: this.centerX - width / 2, y: this.centerY - height / 2, width, height };
  }

  /** Zooms by `factor`, keeping the world point under the cursor in place. */
  zoomAt(screen: Point, factor: number): void {
    this.animation = undefined;
    const before = this.screenToWorld(screen);
    this.scale = clampScale(this.scale * factor);
    const after = this.screenToWorld(screen);
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
    this.apply();
  }

  panByScreenPixels(deltaX: number, deltaY: number): void {
    this.animation = undefined;
    this.centerX -= deltaX / this.scale;
    this.centerY -= deltaY / this.scale;
    this.apply();
  }

  /** The camera state that shows the whole rectangle with a margin. */
  stateToFit(rect: Rect, maxScale = 1): CameraState {
    const margin = 40;
    const scaleX = (this.viewWidth - margin * 2) / Math.max(1, rect.width);
    const scaleY = (this.viewHeight - margin * 2) / Math.max(1, rect.height);
    return {
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + rect.height / 2,
      scale: clampScale(Math.min(scaleX, scaleY, maxScale)),
    };
  }

  animateTo(target: CameraState, durationMs = 400): void {
    this.animation = { from: this.state, to: { ...target, scale: clampScale(target.scale) }, startTime: performance.now(), durationMs };
  }

  /** Advances the animation, if any. Returns true when the camera moved. */
  update(now: number): boolean {
    if (this.animation === undefined) {
      return false;
    }
    const { from, to, startTime, durationMs } = this.animation;
    const progress = Math.min(1, (now - startTime) / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease-out: fast start, gentle stop.
    this.centerX = from.centerX + (to.centerX - from.centerX) * eased;
    this.centerY = from.centerY + (to.centerY - from.centerY) * eased;
    // Zoom is interpolated geometrically, so zooming from 0.1 to 1 feels as smooth as from 1 to 10.
    this.scale = from.scale * Math.pow(to.scale / from.scale, eased);
    if (progress >= 1) {
      this.animation = undefined;
    }
    this.apply();
    return true;
  }

  private apply(): void {
    this.world.scale.set(this.scale);
    this.world.position.set(this.viewWidth / 2 - this.centerX * this.scale, this.viewHeight / 2 - this.centerY * this.scale);
  }
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

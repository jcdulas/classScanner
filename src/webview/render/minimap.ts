// The minimap in the corner of the diagram (spec §4.6).
//
// It is a plain 2D canvas, separate from WebGL: it draws every group and card
// as a small rectangle, plus the rectangle of the current view. Clicking or
// dragging on it moves the camera there. The rectangles are drawn once into
// a cached canvas when the diagram changes; each camera move only redraws
// the cached picture and the view rectangle.

import { Point } from '../../shared/savedState';
import { Rect, expandRect, unionOfRects } from '../model/geometry';
import { Theme, toCssColor } from './theme';

const WIDTH = 220;
const HEIGHT = 150;

export interface MinimapShape {
  rect: Rect;
  color: number;
  isGroup: boolean;
}

export class Minimap {
  readonly element = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly cache = document.createElement('canvas');
  private worldBounds: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private viewRect: Rect | undefined;
  private theme: Theme | undefined;

  constructor(private readonly onNavigate: (worldPoint: Point) => void) {
    const pixelRatio = window.devicePixelRatio || 1;
    for (const canvas of [this.element, this.cache]) {
      canvas.width = WIDTH * pixelRatio;
      canvas.height = HEIGHT * pixelRatio;
    }
    this.element.className = 'minimap';
    this.element.style.width = `${WIDTH}px`;
    this.element.style.height = `${HEIGHT}px`;
    this.context = this.element.getContext('2d')!;
    this.context.scale(pixelRatio, pixelRatio);
    this.cache.getContext('2d')!.scale(pixelRatio, pixelRatio);
    this.attachPointerHandlers();
  }

  setShapes(shapes: MinimapShape[], theme: Theme): void {
    this.theme = theme;
    this.worldBounds = expandRect(unionOfRects(shapes.map((shape) => shape.rect)) ?? { x: 0, y: 0, width: 1, height: 1 }, 50);
    const context = this.cache.getContext('2d')!;
    // No background: the glass style of the minimap element shows through (see styles.css).
    context.clearRect(0, 0, WIDTH, HEIGHT);
    for (const shape of shapes) {
      const rect = this.worldToMinimap(shape.rect);
      context.globalAlpha = shape.isGroup ? 0.25 : 0.9;
      context.fillStyle = toCssColor(shape.color);
      context.fillRect(rect.x, rect.y, Math.max(1, rect.width), Math.max(1, rect.height));
    }
    context.globalAlpha = 1;
    this.draw();
  }

  setViewRect(viewRect: Rect): void {
    this.viewRect = viewRect;
    this.draw();
  }

  private draw(): void {
    const pixelRatio = window.devicePixelRatio || 1;
    this.context.clearRect(0, 0, WIDTH, HEIGHT);
    this.context.drawImage(this.cache, 0, 0, WIDTH * pixelRatio, HEIGHT * pixelRatio, 0, 0, WIDTH, HEIGHT);
    if (this.viewRect !== undefined && this.theme !== undefined) {
      const rect = this.worldToMinimap(this.viewRect);
      this.context.strokeStyle = toCssColor(this.theme.accent);
      this.context.lineWidth = 1.5;
      this.context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  /** The world bounds are fitted into the minimap, keeping their proportions. */
  private get mapScale(): number {
    return Math.min(WIDTH / this.worldBounds.width, HEIGHT / this.worldBounds.height);
  }

  private worldToMinimap(rect: Rect): Rect {
    const scale = this.mapScale;
    return {
      x: (rect.x - this.worldBounds.x) * scale,
      y: (rect.y - this.worldBounds.y) * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    };
  }

  private minimapToWorld(x: number, y: number): Point {
    const scale = this.mapScale;
    return { x: this.worldBounds.x + x / scale, y: this.worldBounds.y + y / scale };
  }

  private attachPointerHandlers(): void {
    let isDragging = false;
    const navigate = (event: PointerEvent) => {
      const bounds = this.element.getBoundingClientRect();
      this.onNavigate(this.minimapToWorld(event.clientX - bounds.left, event.clientY - bounds.top));
    };
    this.element.addEventListener('pointerdown', (event) => {
      isDragging = true;
      this.element.setPointerCapture(event.pointerId);
      navigate(event);
    });
    this.element.addEventListener('pointermove', (event) => {
      if (isDragging) {
        navigate(event);
      }
    });
    this.element.addEventListener('pointerup', () => {
      isDragging = false;
    });
  }
}

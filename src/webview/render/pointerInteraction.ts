// Mouse and touchpad interactions on the diagram (spec §4.6).
//
//   wheel                          zoom around the cursor
//   drag on the background         pan
//   Ctrl/Cmd + drag anywhere       rectangle selection (replaces the selection; with Shift, adds to it)
//   Shift + drag on the background rectangle selection, added to the current selection
//   drag a card or a group title   move it; dragging a selected card moves the whole selection
//   click a card                   select it alone
//   Ctrl/Cmd + click a card        add it to the selection, or remove it (Shift + click does the same)
//   click a member line            open the member's declaration
//   Alt + click a card             open the class declaration
//   double-click a card            cycle its display mode
//   double-click a group title     collapse or expand the group
//   right-click                    context menu
//
// A press only becomes a drag once the pointer has moved a few pixels, so
// that a slightly shaky click is still a click.

import { Point } from '../../shared/savedState';
import { CardRow } from '../model/cardGeometry';
import { Rect } from '../model/geometry';
import { DiagramStore } from '../state/diagramStore';
import { Camera } from './camera';
import { HitTarget } from './spatialIndex';

const DRAG_THRESHOLD_PIXELS = 4;

export interface InteractionContext {
  store: DiagramStore;
  camera: Camera;
  hitTest(worldPoint: Point): HitTarget | undefined;
  rowAt(cardId: string, worldPoint: Point): CardRow | undefined;
  openSource(file: number, line: number): void;
  idsInRect(worldRect: Rect): string[];
  groupMemberIds(groupKey: string): string[];
  showSelectionRectangle(worldRect: Rect | undefined): void;
  onCameraMoved(): void;
  onHover(worldPoint: Point, screenPoint: Point): void;
}

interface Modifiers {
  shift: boolean;
  /** Ctrl on Windows and Linux, Cmd on macOS. */
  command: boolean;
  alt: boolean;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pressed'; startScreen: Point; target: HitTarget | undefined; modifiers: Modifiers }
  | { kind: 'pan'; lastScreen: Point }
  | { kind: 'moveNodes'; ids: string[]; lastWorld: Point }
  | { kind: 'rectangle'; startWorld: Point; isAdditive: boolean };

export class PointerInteraction {
  private gesture: Gesture = { kind: 'none' };

  constructor(
    private readonly element: HTMLElement,
    private readonly context: InteractionContext,
  ) {
    element.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    element.addEventListener('pointermove', (event) => this.onPointerMove(event));
    element.addEventListener('pointerup', (event) => this.onPointerUp(event));
    element.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    element.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    element.addEventListener('contextmenu', (event) => this.onContextMenu(event));
  }

  private screenPoint(event: MouseEvent): Point {
    const bounds = this.element.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private worldPoint(event: MouseEvent): Point {
    return this.context.camera.screenToWorld(this.screenPoint(event));
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.context.store.contextMenu !== null) {
      this.context.store.openContextMenu(null);
    }
    if (event.button === 1) {
      // Middle button: always pans.
      this.gesture = { kind: 'pan', lastScreen: this.screenPoint(event) };
    } else if (event.button === 0) {
      this.gesture = {
        kind: 'pressed',
        startScreen: this.screenPoint(event),
        target: this.context.hitTest(this.worldPoint(event)),
        modifiers: { shift: event.shiftKey, command: event.ctrlKey || event.metaKey, alt: event.altKey },
      };
    } else {
      return;
    }
    this.element.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    const screen = this.screenPoint(event);
    const world = this.context.camera.screenToWorld(screen);
    const gesture = this.gesture;
    switch (gesture.kind) {
      case 'none':
        this.context.onHover(world, screen);
        return;
      case 'pressed':
        if (Math.hypot(screen.x - gesture.startScreen.x, screen.y - gesture.startScreen.y) >= DRAG_THRESHOLD_PIXELS) {
          this.startDrag(gesture, world);
        }
        return;
      case 'pan':
        this.context.camera.panByScreenPixels(screen.x - gesture.lastScreen.x, screen.y - gesture.lastScreen.y);
        this.context.onCameraMoved();
        gesture.lastScreen = screen;
        return;
      case 'moveNodes':
        this.context.store.moveNodes(gesture.ids, world.x - gesture.lastWorld.x, world.y - gesture.lastWorld.y);
        gesture.lastWorld = world;
        return;
      case 'rectangle':
        this.context.showSelectionRectangle(rectFromCorners(gesture.startWorld, world));
        return;
    }
  }

  /** Decides what a press turns into once the pointer moves. */
  private startDrag(pressed: Extract<Gesture, { kind: 'pressed' }>, world: Point): void {
    const { store } = this.context;
    const startWorld = this.context.camera.screenToWorld(pressed.startScreen);
    const target = pressed.target;
    if (pressed.modifiers.command) {
      // Ctrl + drag always draws a selection rectangle, even when it starts on a card.
      this.gesture = { kind: 'rectangle', startWorld, isAdditive: pressed.modifiers.shift };
      this.context.showSelectionRectangle(rectFromCorners(startWorld, world));
      return;
    }
    if (target?.kind === 'card') {
      if (!store.selection.has(target.id)) {
        store.select([target.id], pressed.modifiers.shift ? 'add' : 'replace');
      }
      this.gesture = { kind: 'moveNodes', ids: Array.from(store.selection), lastWorld: startWorld };
    } else if (target !== undefined) {
      this.gesture = { kind: 'moveNodes', ids: this.context.groupMemberIds(target.key), lastWorld: startWorld };
    } else if (pressed.modifiers.shift) {
      this.gesture = { kind: 'rectangle', startWorld, isAdditive: true };
    } else {
      this.gesture = { kind: 'pan', lastScreen: pressed.startScreen };
    }
    // Apply the movement made since the press. The whole drag is one step for "undo".
    if (this.gesture.kind === 'moveNodes') {
      store.rememberForUndo();
      store.moveNodes(this.gesture.ids, world.x - startWorld.x, world.y - startWorld.y);
      this.gesture.lastWorld = world;
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    this.gesture = { kind: 'none' };
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    if (gesture.kind === 'pressed') {
      this.handleClick(gesture, this.worldPoint(event));
    } else if (gesture.kind === 'rectangle') {
      const ids = this.context.idsInRect(rectFromCorners(gesture.startWorld, this.worldPoint(event)));
      this.context.store.select(ids, gesture.isAdditive ? 'add' : 'replace');
      this.context.showSelectionRectangle(undefined);
    }
  }

  private handleClick(pressed: Extract<Gesture, { kind: 'pressed' }>, world: Point): void {
    const { store } = this.context;
    const target = pressed.target;
    if (target === undefined) {
      store.clearSelection();
      return;
    }
    // Ctrl or Shift keeps the current selection and changes it; a plain click replaces it.
    const keepsSelection = pressed.modifiers.command || pressed.modifiers.shift;
    if (target.kind !== 'card') {
      store.select(this.context.groupMemberIds(target.key), keepsSelection ? 'add' : 'replace');
      return;
    }
    const node = store.nodeById.get(target.id);
    if (node === undefined) {
      return;
    }
    if (pressed.modifiers.alt) {
      this.context.openSource(node.file, node.line);
      return;
    }
    if (keepsSelection) {
      store.select([target.id], 'toggle');
      return;
    }
    store.select([target.id], 'replace');
    const member = this.context.rowAt(target.id, world)?.member;
    if (member !== undefined) {
      this.context.openSource(member.file, member.line);
    }
  }

  private onDoubleClick(event: MouseEvent): void {
    const target = this.context.hitTest(this.worldPoint(event));
    if (target?.kind === 'card') {
      this.context.store.cycleDisplayMode(target.id);
    } else if (target !== undefined) {
      void this.context.store.toggleGroupCollapsed(target.key);
    }
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    // Mice report lines, touchpads report pixels: lines are converted to an approximate pixel count.
    const deltaPixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 40 : event.deltaY;
    this.context.camera.zoomAt(this.screenPoint(event), Math.exp(-deltaPixels * 0.0015));
    this.context.onCameraMoved();
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const { store } = this.context;
    const screen = this.screenPoint(event);
    const target = this.context.hitTest(this.worldPoint(event));
    if (target?.kind === 'card') {
      if (!store.selection.has(target.id)) {
        store.select([target.id], 'replace');
      }
      store.openContextMenu({ screenX: screen.x, screenY: screen.y, nodeId: target.id });
    } else if (target !== undefined) {
      store.openContextMenu({ screenX: screen.x, screenY: screen.y, groupKey: target.key });
    } else {
      store.openContextMenu({ screenX: screen.x, screenY: screen.y });
    }
  }
}

function rectFromCorners(first: Point, second: Point): Rect {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

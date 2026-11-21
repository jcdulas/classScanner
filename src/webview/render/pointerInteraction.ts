// Mouse and touchpad interactions on the diagram (spec §4.6).
//
//   wheel                          zoom around the cursor
//   drag on the background         pan
//   Ctrl/Cmd + drag anywhere       rectangle selection (replaces the selection; with Shift, adds to it)
//   Shift + drag on the background rectangle selection, added to the current selection
//   drag a card or a group title   move it; dragging a selected card moves the whole selection
//   click a card                   select it alone
//   Ctrl/Cmd + click a card        add it to the selection, or remove it (Shift + click does the same)
//   click an arrow                 open the declaration of its relation in the editor
//   double-click a card            open what is under the pointer in the editor: the member on a
//                                  member line, the class elsewhere. It opens the side that the
//                                  user prefers, the definition (.cpp) unless changed in the side
//                                  panel; with Shift, the other side
//   Alt + double-click a card      cycle its display mode
//   double-click a group title     collapse or expand the group
//   right-click                    context menu
//
// Each gesture does one thing. In particular a plain click on a card only
// selects: it never opens a file, so that selecting or dragging a card cannot
// open one by accident. Code is opened with a double-click, the context menu
// or the selection bar. An arrow has nothing to select or to move, so a click
// on it opens its declaration; the arrow under the pointer is highlighted,
// which shows what a click will do.
//
// A press only becomes a drag once the pointer has moved a few pixels, so
// that a slightly shaky click is still a click.

import { SourceLocation } from '../../shared/graphModel';
import { Point } from '../../shared/savedState';
import { CardRow } from '../model/cardGeometry';
import { Rect } from '../model/geometry';
import { codeLocationOf, otherCodeSide } from '../model/openTargets';
import { DiagramStore } from '../state/diagramStore';
import { Camera } from './camera';
import { HitTarget } from './spatialIndex';

const DRAG_THRESHOLD_PIXELS = 4;

export interface InteractionContext {
  store: DiagramStore;
  camera: Camera;
  hitTest(worldPoint: Point): HitTarget | undefined;
  rowAt(cardId: string, worldPoint: Point): CardRow | undefined;
  /** Where the relation of the arrow under the point is declared, when there is an arrow. */
  relationDeclarationAt(worldPoint: Point): SourceLocation | undefined;
  openSource(file: number, line: number): void;
  idsInRect(worldRect: Rect): string[];
  groupMemberIds(groupKey: string): string[];
  showSelectionRectangle(worldRect: Rect | undefined): void;
  onCameraMoved(): void;
  onHover(worldPoint: Point, screenPoint: Point): void;
  /** The pointer left the diagram. */
  onHoverEnded(): void;
}

interface Modifiers {
  shift: boolean;
  /** Ctrl on Windows and Linux, Cmd on macOS. */
  command: boolean;
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
    element.addEventListener('pointerleave', () => this.context.onHoverEnded());
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
        modifiers: { shift: event.shiftKey, command: event.ctrlKey || event.metaKey },
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
    // Ctrl or Shift keeps the current selection and changes it; a plain click replaces it.
    const keepsSelection = pressed.modifiers.command || pressed.modifiers.shift;
    if (target === undefined) {
      // Cards hide the arrows that pass behind them, so an arrow is only looked for outside of the cards.
      const declaration = keepsSelection ? undefined : this.context.relationDeclarationAt(world);
      if (declaration !== undefined) {
        // The selection is kept: its arrows stay highlighted, ready for the next click.
        this.context.openSource(declaration.file, declaration.line);
        return;
      }
      store.clearSelection();
      return;
    }
    if (target.kind !== 'card') {
      store.select(this.context.groupMemberIds(target.key), keepsSelection ? 'add' : 'replace');
      return;
    }
    store.select([target.id], keepsSelection ? 'toggle' : 'replace');
  }

  private onDoubleClick(event: MouseEvent): void {
    const { store } = this.context;
    const world = this.worldPoint(event);
    const target = this.context.hitTest(world);
    if (target === undefined) {
      return;
    }
    if (target.kind !== 'card') {
      void store.toggleGroupCollapsed(target.key);
      return;
    }
    if (event.altKey) {
      store.cycleDisplayMode(target.id);
      return;
    }
    const node = store.nodeById.get(target.id);
    if (node === undefined) {
      return;
    }
    // The two clicks of a Shift + double-click each toggled the card in the selection, which
    // left it as it was: only the file opens.
    const side = event.shiftKey ? otherCodeSide(store.doubleClickOpens) : store.doubleClickOpens;
    const location = codeLocationOf(node, this.context.rowAt(target.id, world)?.member, side);
    this.context.openSource(location.file, location.line);
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
    const world = this.worldPoint(event);
    const target = this.context.hitTest(world);
    if (target?.kind === 'card') {
      if (!store.selection.has(target.id)) {
        store.select([target.id], 'replace');
      }
      const member = this.context.rowAt(target.id, world)?.member;
      store.openContextMenu({ screenX: screen.x, screenY: screen.y, nodeId: target.id, member });
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

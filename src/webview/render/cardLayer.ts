// All the class cards of the diagram, and the viewport culling (spec §4.1).
//
// Every class has a CardView, created once per graph. Culling: on each camera
// move, the spatial index gives the cards inside the visible area; only those
// are "renderable" (drawn by the GPU) and have their text content. The others
// keep only their small background object.

import { Container } from 'pixi.js';
import { Point } from '../../shared/savedState';
import { FontMetrics } from '../model/cardGeometry';
import { DiagramStore } from '../state/diagramStore';
import { CardView } from './cardView';
import { CardContent, cardContentFor } from './levelOfDetail';
import { PixelFonts } from './pixelFonts';
import { Theme, groupColor } from './theme';

export class CardLayer {
  readonly container = new Container();
  private views = new Map<string, CardView>();
  private renderableIds = new Set<string>();
  /** When set, every shown card is drawn with full detail, ignoring culling (used by the PNG export). */
  private isExportMode = false;

  constructor(
    private readonly metrics: FontMetrics,
    private readonly fonts: PixelFonts,
  ) {}

  view(id: string): CardView | undefined {
    return this.views.get(id);
  }

  /** Creates the views of a new graph. */
  rebuild(store: DiagramStore, theme: Theme): void {
    for (const view of this.views.values()) {
      view.destroy();
    }
    this.views = new Map();
    this.renderableIds = new Set();
    for (const node of store.graph?.nodes ?? []) {
      const layout = store.cardLayouts.get(node.id)!;
      const view = new CardView(node.id, layout, this.headerColorOf(store, theme, node.id), theme, this.metrics, node.isAbstract, this.fonts);
      view.container.visible = false;
      view.container.renderable = false;
      this.views.set(node.id, view);
      this.container.addChild(view.container);
    }
  }

  syncLayouts(store: DiagramStore): void {
    for (const [id, view] of this.views) {
      view.setLayout(store.cardLayouts.get(id)!);
    }
  }

  syncStyles(store: DiagramStore, theme: Theme): void {
    for (const [id, view] of this.views) {
      view.setStyle(theme, this.headerColorOf(store, theme, id));
    }
  }

  /**
   * `overrides` replaces some positions, for the animation between two layouts. Cards are
   * placed on whole pixels of the screen, like their texts, to keep the text sharp.
   */
  syncPositions(positions: Map<string, Point>, overrides?: Map<string, Point>): void {
    for (const [id, view] of this.views) {
      const position = overrides?.get(id) ?? positions.get(id);
      if (position !== undefined) {
        view.container.position.set(this.fonts.snap(position.x), this.fonts.snap(position.y));
      }
    }
  }

  /** Places the cards and creates their texts again, after the zoom that fonts are made for changed. */
  refreshFonts(positions: Map<string, Point>): void {
    this.syncPositions(positions);
    for (const view of this.views.values()) {
      view.refreshFonts();
    }
  }

  syncShown(isShown: (id: string) => boolean, positions: Map<string, Point>): void {
    for (const [id, view] of this.views) {
      view.container.visible = isShown(id) && positions.has(id);
    }
  }

  syncSelection(selection: Set<string>, focusedIds: Set<string> | null): void {
    for (const [id, view] of this.views) {
      view.setSelected(selection.has(id));
      view.setDimmed(focusedIds !== null && !focusedIds.has(id));
    }
  }

  /** Makes renderable only the cards in `idsInView`, each with the content given by `contentOf`. */
  updateCulling(idsInView: Set<string>, contentOf: (id: string) => CardContent): void {
    if (this.isExportMode) {
      return;
    }
    for (const id of this.renderableIds) {
      if (!idsInView.has(id)) {
        const view = this.views.get(id);
        if (view !== undefined) {
          view.container.renderable = false;
          view.setContent('none');
        }
      }
    }
    for (const id of idsInView) {
      const view = this.views.get(id);
      if (view !== undefined && view.container.visible) {
        view.container.renderable = true;
        view.setContent(contentOf(id));
      }
    }
    this.renderableIds = idsInView;
  }

  /** Shows every shown card with full detail, for an export of the whole diagram. */
  enterExportMode(store: DiagramStore): void {
    this.isExportMode = true;
    for (const [id, view] of this.views) {
      if (view.container.visible) {
        view.container.renderable = true;
        view.setContent(cardContentFor('full', store.displayModeOf(id)));
      }
    }
  }

  leaveExportMode(): void {
    this.isExportMode = false;
    for (const view of this.views.values()) {
      view.container.renderable = false;
      view.setContent('none');
    }
    this.renderableIds = new Set();
  }

  private headerColorOf(store: DiagramStore, theme: Theme, id: string): number {
    return groupColor(theme, store.groupKeyByNode.get(id) ?? '');
  }
}

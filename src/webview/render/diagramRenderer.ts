// Draws the diagram with PixiJS (WebGL) and keeps it in sync with the store (spec §4).
//
// The renderer listens to the store. Changes are not applied immediately:
// they are collected as "dirty" topics and processed once per animation
// frame, so that a burst of changes (for example while dragging cards)
// costs one redraw per frame, not one per change.
//
// Drawing order, from back to front: group boxes, edges, cards, collapsed
// groups, group titles, selection rectangle.

import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import { Edge, RelationKind } from '../../shared/graphModel';
import { ExportScope, FrameStatistics } from '../../shared/messages';
import { Point } from '../../shared/savedState';
import { CardRow, FontMetrics } from '../model/cardGeometry';
import { Rect, expandRect, rectContainsPoint, unionOfRects } from '../model/geometry';
import { GROUP_STYLE } from '../model/groups';
import {
  DisplayedEdges,
  DisplayedEdgesOptions,
  GroupBox,
  cardRect,
  computeDisplayedEdges,
  computeGroupBoxes,
  isCardShown,
} from '../model/sceneGeometry';
import { edgeSegment } from '../model/edgeGeometry';
import { distanceToSegment } from '../model/edgeHitTest';
import { RoutedEdge, RoutingStyle, routingStyleForLayout } from '../model/edgeRouting';
import { ChangeTopic, DiagramStore, LevelOfDetail, StoreChange } from '../state/diagramStore';
import { RELATION_LABELS } from '../ui/labels';
import { Camera, ViewInsets } from './camera';
import { CardLayer } from './cardLayer';
import { EdgeLayer } from './edgeLayer';
import { editorFontFamily } from './fonts';
import { GroupLayer } from './groupLayer';
import { CardContent, TEXT_MIN_SCALE, cardContentFor, levelOfDetailForScale, unsimplifiedCardContentFor } from './levelOfDetail';
import { Minimap } from './minimap';
import { PixelFonts } from './pixelFonts';
import { delay, measurePanningPerformance, measureRelationToggle } from './performanceProbe';
import { PointerInteraction } from './pointerInteraction';
import { HitTarget, IndexedItem, SpatialIndex } from './spatialIndex';
import { Theme, groupColor, readTheme, watchThemeChanges } from './theme';

export interface RendererCallbacks {
  openSource(file: number, line: number): void;
  /** Called once the cards of a newly loaded graph are on screen. */
  onDiagramShown(visibleNodeCount: number): void;
}

type DirtyTopic = ChangeTopic | 'theme';

/** Edges are rebuilt when the zoom changed by more than this factor since they were built. */
const EDGE_REBUILD_ZOOM_FACTOR = 1.3;
/** Delay after the last camera move before the text and the edges are redrawn for the new view. */
const CAMERA_SETTLE_MS = 150;
const LAYOUT_ANIMATION_MS = 450;
/** An arrow is under the pointer when the pointer is this close to its line, in screen pixels. */
const EDGE_HIT_TOLERANCE_PIXELS = 5;

interface PositionAnimation {
  from: Map<string, Point>;
  to: Map<string, Point>;
  startTime: number;
}

export class DiagramRenderer {
  readonly camera: Camera;
  private readonly world = new Container();
  private readonly cardLayer: CardLayer;
  private readonly groupLayer: GroupLayer;
  private readonly edgeLayer = new EdgeLayer();
  private readonly selectionRectangle = new Graphics();
  private readonly spatialIndex = new SpatialIndex();
  private readonly minimap: Minimap;
  private readonly fonts = new PixelFonts(editorFontFamily());
  private readonly tooltip = document.createElement('div');
  private theme: Theme;
  private groupBoxes = new Map<string, GroupBox>();
  private displayedEdges: DisplayedEdges = { individual: [], aggregated: [] };
  /** The arrow under the pointer, drawn in the accent color: a click opens its declaration. */
  private hoveredRoute: RoutedEdge | undefined;
  private dirty = new Set<DirtyTopic>();
  private level: LevelOfDetail = 'compact';
  private isCameraDirty = true;
  private lastCameraMoveTime = 0;
  private hasSavedCameraSinceMove = true;
  private edgeBuildScale = 1;
  private edgeCullRect: Rect | undefined;
  /** Relation kinds whose batch was drawn for the current scene, view and zoom. */
  private upToDateEdgeKinds = new Set<RelationKind>();
  private animation: PositionAnimation | undefined;
  private isWaitingToShowDiagram = false;
  private hasPlacedCamera = false;

  private constructor(
    private readonly app: Application,
    private readonly host: HTMLElement,
    private readonly store: DiagramStore,
    metrics: FontMetrics,
    private readonly callbacks: RendererCallbacks,
  ) {
    this.theme = readTheme();
    this.camera = new Camera(this.world);
    this.camera.setPixelRatio(app.renderer.resolution);
    this.cardLayer = new CardLayer(metrics, this.fonts);
    this.groupLayer = new GroupLayer(metrics, this.fonts);
    this.world.addChild(
      this.groupLayer.boxContainer,
      this.edgeLayer.container,
      this.cardLayer.container,
      this.groupLayer.collapsedContainer,
      this.groupLayer.titleContainer,
      this.selectionRectangle,
    );
    app.stage.addChild(this.world);
    // Pointer events are handled on the canvas with the spatial index, not by PixiJS objects.
    app.stage.eventMode = 'none';

    this.minimap = new Minimap((worldPoint) => this.centerOn(worldPoint));
    this.tooltip.className = 'diagram-tooltip';
    this.tooltip.hidden = true;
    host.append(this.minimap.element, this.tooltip);

    new PointerInteraction(app.canvas, {
      store,
      camera: this.camera,
      hitTest: (point) => this.spatialIndex.hitTest(point)?.target,
      rowAt: (cardId, point) => this.rowAt(cardId, point),
      relationDeclarationAt: (point) => this.routeAt(point)?.edge.declarations[0],
      openSource: (file, line) => callbacks.openSource(file, line),
      idsInRect: (rect) => this.cardIdsInRect(rect),
      groupMemberIds: (key) => this.groupBoxes.get(key)?.memberIds ?? [],
      showSelectionRectangle: (rect) => this.drawSelectionRectangle(rect),
      onCameraMoved: () => this.markCameraMoved(),
      onHover: (world, screen) => this.updateHover(world, screen),
      onHoverEnded: () => this.clearHover(),
    });

    store.subscribe((change) => this.onStoreChange(change));
    watchThemeChanges(() => this.dirty.add('theme'));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    app.ticker.add(() => this.onFrame());
  }

  static async create(host: HTMLElement, store: DiagramStore, metrics: FontMetrics, callbacks: RendererCallbacks): Promise<DiagramRenderer> {
    const app = new Application();
    await app.init({
      preference: 'webgl',
      // The canvas is transparent: the page background shows behind the diagram (see styles.css).
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
    });
    host.appendChild(app.canvas);
    return new DiagramRenderer(app, host, store, metrics, callbacks);
  }

  // ---------------------------------------------------------------------------
  // Camera actions used by the user interface
  // ---------------------------------------------------------------------------

  /** Shows the whole visible diagram. */
  fitToView(animate = true): void {
    const bounds = this.shownBounds();
    if (bounds === undefined) {
      return;
    }
    const target = this.camera.stateToFit(bounds, this.viewInsets());
    if (animate) {
      this.camera.animateTo(target);
    } else {
      this.camera.setState(target);
    }
    this.markCameraMoved();
  }

  /** Moves the camera to a class and zooms in enough to read it (spec §4.6, search). */
  focusNode(id: string): void {
    const rect = cardRect(this.store, id);
    if (rect === undefined) {
      return;
    }
    this.camera.animateTo({
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + rect.height / 2,
      scale: Math.max(this.camera.scale, 0.8),
    });
    this.markCameraMoved();
  }

  /** Moves the camera so that the given classes fill the view, without zooming in closer than full size. */
  showNodes(ids: string[]): void {
    const rects = ids.map((id) => cardRect(this.store, id)).filter((rect): rect is Rect => rect !== undefined);
    const bounds = unionOfRects(rects);
    if (bounds === undefined) {
      return;
    }
    const target = this.camera.stateToFit(bounds, this.viewInsets());
    this.camera.animateTo({ ...target, scale: Math.min(target.scale, 1) });
    this.markCameraMoved();
  }

  async measurePerformance(): Promise<FrameStatistics[]> {
    const statistics = await measurePanningPerformance(this.camera, this.app.ticker, () => this.markCameraMoved());
    // Toggling the most numerous relation kind with the whole diagram in view: every edge of
    // that kind is drawn, which is the worst case.
    this.fitToView(false);
    await delay(CAMERA_SETTLE_MS * 3);
    const kind = this.mostNumerousRelationKind();
    const toggle = () => this.store.toggleRelation(kind);
    const firstMs = await measureRelationToggle(this.app.ticker, toggle);
    const firstLabel = `toggle ${kind} ${this.store.activeRelations.has(kind) ? 'on' : 'off'}`;
    // Moving the view while the kind is off makes its batch out of date: the next toggle must redraw it.
    this.camera.panByScreenPixels(this.camera.viewWidth, 0);
    this.markCameraMoved();
    await delay(CAMERA_SETTLE_MS * 3);
    const secondMs = await measureRelationToggle(this.app.ticker, toggle);
    const secondLabel = `toggle ${kind} ${this.store.activeRelations.has(kind) ? 'on' : 'off'} after a camera move`;
    for (const [level, duration] of [[firstLabel, firstMs], [secondLabel, secondMs]] as const) {
      statistics.push({ level, frameCount: 1, averageFrameMs: duration, percentile95FrameMs: duration });
    }
    statistics.push(...(await this.measureFullCardsWhenZoomedOut()));
    return statistics;
  }

  /** Frame times when cards are not simplified: whole diagram in view, then the farthest zoom that draws text. */
  private async measureFullCardsWhenZoomedOut(): Promise<FrameStatistics[]> {
    const wasSimplifying = this.store.simplifyCardsWhenZoomedOut;
    this.store.setSimplifyCardsWhenZoomedOut(false);
    this.fitToView(false);
    // Lets the text of every card be created before measuring.
    await delay(1500);
    const levels = [
      { level: 'whole diagram, full cards', scale: this.camera.scale },
      { level: 'smallest readable text, full cards', scale: TEXT_MIN_SCALE * 1.05 },
    ];
    const statistics = await measurePanningPerformance(this.camera, this.app.ticker, () => this.markCameraMoved(), levels);
    this.store.setSimplifyCardsWhenZoomedOut(wasSimplifying);
    return statistics;
  }

  private mostNumerousRelationKind(): RelationKind {
    const counts = new Map<RelationKind, number>();
    for (const edge of this.store.graph?.edges ?? []) {
      counts.set(edge.kind, (counts.get(edge.kind) ?? 0) + 1);
    }
    let best: RelationKind = 'inherit';
    for (const [kind, count] of counts) {
      if (count > (counts.get(best) ?? 0)) {
        best = kind;
      }
    }
    return best;
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt({ x: this.camera.viewWidth / 2, y: this.camera.viewHeight / 2 }, factor);
    this.markCameraMoved();
  }

  private centerOn(worldPoint: Point): void {
    this.camera.setState({ centerX: worldPoint.x, centerY: worldPoint.y, scale: this.camera.scale });
    this.markCameraMoved();
  }

  // ---------------------------------------------------------------------------
  // Change processing
  // ---------------------------------------------------------------------------

  private onStoreChange(change: StoreChange): void {
    for (const topic of change.topics) {
      this.dirty.add(topic);
    }
    if (change.topics.has('graph')) {
      this.isWaitingToShowDiagram = true;
    }
    if (change.animatePositions && !change.topics.has('graph')) {
      this.startLayoutAnimation(change.fitView === true);
    }
  }

  private markCameraMoved(): void {
    this.isCameraDirty = true;
    this.lastCameraMoveTime = performance.now();
    this.hasSavedCameraSinceMove = false;
  }

  private onFrame(): void {
    const now = performance.now();
    if (this.camera.update(now)) {
      this.markCameraMoved();
    }
    if (this.animation !== undefined) {
      this.stepLayoutAnimation(now);
      return;
    }
    this.processDirtyTopics();
    if (this.isCameraDirty) {
      this.isCameraDirty = false;
      this.onCameraChanged();
    }
    this.redrawWhenCameraSettles(now);
  }

  private processDirtyTopics(): void {
    if (this.dirty.size === 0) {
      return;
    }
    const dirty = this.dirty;
    this.dirty = new Set();
    const has = (topic: DirtyTopic) => dirty.has(topic);

    if (has('graph')) {
      this.cardLayer.rebuild(this.store, this.theme);
    }
    if (has('theme')) {
      this.theme = readTheme();
    }
    if (has('cards')) {
      this.cardLayer.syncLayouts(this.store);
    }
    if (has('groups') || has('theme') || has('graph')) {
      this.cardLayer.syncStyles(this.store, this.theme);
    }
    const sceneChanged = ['graph', 'groups', 'cards', 'positions', 'visibility', 'theme'].some((topic) => has(topic as DirtyTopic));
    if (sceneChanged) {
      this.rebuildScene();
    }
    if (sceneChanged || has('zoomOptions')) {
      this.rebuildEdges();
      // The content of the cards may have to change too: the next frame redoes the culling.
      this.isCameraDirty = true;
    } else if (has('relations')) {
      this.updateEdgesForRelationChange();
    } else if (has('selection')) {
      this.rebuildHighlight();
    }
    if (sceneChanged || has('relations') || has('selection')) {
      this.cardLayer.syncSelection(this.store.selection, this.focusedIdsOrNull());
    }
    if (this.isWaitingToShowDiagram && this.store.phase === 'ready' && this.store.positions.size > 0) {
      this.showLoadedDiagram();
    }
  }

  /** Positions, groups, spatial index and minimap: everything that depends on where the cards are. */
  private rebuildScene(): void {
    const store = this.store;
    this.cardLayer.syncPositions(store.positions);
    this.groupBoxes = computeGroupBoxes(store);
    this.groupLayer.sync(this.groupBoxes, this.theme);
    this.groupLayer.updateTitleScale(this.camera.scale);
    this.cardLayer.syncShown((id) => isCardShown(store, this.groupBoxes, id), store.positions);
    this.rebuildSpatialIndex();
    this.updateMinimap();
    this.isCameraDirty = true;
  }

  private rebuildSpatialIndex(): void {
    const items: IndexedItem[] = [];
    for (const id of this.store.visibleNodeIds) {
      const rect = cardRect(this.store, id);
      if (rect !== undefined && isCardShown(this.store, this.groupBoxes, id)) {
        items.push({ target: { kind: 'card', id }, rect, priority: 3 });
      }
    }
    for (const box of this.groupBoxes.values()) {
      if (box.isCollapsed) {
        items.push({ target: { kind: 'collapsedGroup', key: box.key }, rect: box.collapsedRect, priority: 2 });
      } else {
        const titleBand = { x: box.rect.x, y: box.rect.y, width: box.rect.width, height: GROUP_STYLE.titleHeight };
        items.push({ target: { kind: 'groupTitle', key: box.key }, rect: titleBand, priority: 1 });
      }
    }
    this.spatialIndex.rebuild(items);
  }

  private onCameraChanged(): void {
    const newLevel = levelOfDetailForScale(this.camera.scale);
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.store.setLevelOfDetail(newLevel);
      this.edgeLayer.setLabelsReadable(newLevel === 'full');
      if (this.store.mergeRelationsWhenZoomedOut) {
        // Relations are merged between groups at the overview level only.
        this.rebuildEdges();
      }
    }
    this.groupLayer.updateTitleScale(this.camera.scale);
    const view = this.camera.visibleWorldRect();
    const idsInView = new Set<string>();
    for (const item of this.spatialIndex.search(view)) {
      if (item.target.kind === 'card') {
        idsInView.add(item.target.id);
      }
    }
    this.cardLayer.updateCulling(idsInView, (id) => this.cardContentOf(id));
    this.minimap.setViewRect(view);
  }

  /**
   * Draws the text for a zoom and a pixel density (device pixels per screen pixel): texts get
   * fonts made for their exact size and are placed on whole pixels (see pixelFonts.ts).
   */
  private drawTextFor(cameraScale: number, pixelRatio: number): void {
    this.camera.setPixelRatio(pixelRatio);
    if (!this.fonts.setTarget(cameraScale, pixelRatio)) {
      return;
    }
    this.cardLayer.refreshFonts(this.store.positions);
    this.groupLayer.sync(this.groupBoxes, this.theme);
    this.groupLayer.updateTitleScale(cameraScale);
    // Every text was created again: nothing uses the fonts of the previous zoom any more.
    this.fonts.releaseUnusedFonts();
  }

  /**
   * Once the camera stops moving, the text is redrawn sharp for the new zoom. The edges, which
   * are built for an area larger than the view at one zoom, are rebuilt if the camera zoomed a
   * lot or left that area.
   */
  private redrawWhenCameraSettles(now: number): void {
    if (now - this.lastCameraMoveTime < CAMERA_SETTLE_MS || this.hasSavedCameraSinceMove) {
      return;
    }
    this.hasSavedCameraSinceMove = true;
    // Before the first diagram is placed, the camera is still at its default position: not worth saving.
    if (this.hasPlacedCamera) {
      this.store.setCamera(this.camera.state);
    }
    this.drawTextFor(this.camera.scale, this.app.renderer.resolution);
    const zoomRatio = this.camera.scale / this.edgeBuildScale;
    const view = this.camera.visibleWorldRect();
    const isOutsideBuiltArea = this.edgeCullRect === undefined || !containsRect(this.edgeCullRect, view);
    if (zoomRatio > EDGE_REBUILD_ZOOM_FACTOR || zoomRatio < 1 / EDGE_REBUILD_ZOOM_FACTOR || isOutsideBuiltArea) {
      this.rebuildEdges();
    }
  }

  /** Redraws the edges of every active relation kind, for the current view and zoom. */
  private rebuildEdges(): void {
    // The paths are computed again: the highlighted arrow is found again at the next pointer move.
    this.setHoveredRoute(undefined);
    const view = this.camera.visibleWorldRect();
    this.edgeCullRect = expandRect(view, Math.max(view.width, view.height) * 0.5);
    this.edgeBuildScale = this.camera.scale;
    this.displayedEdges = computeDisplayedEdges(this.store, this.groupBoxes, this.displayedEdgesOptions());
    const activeKinds = this.store.activeRelations;
    this.edgeLayer.rebuildBatches(activeKinds, this.displayedEdges, this.theme, this.camera.scale, this.edgeCullRect, this.routingStyle());
    // The batches of inactive kinds were not redrawn: they are out of date until redrawn.
    this.upToDateEdgeKinds = new Set(activeKinds);
    this.edgeLayer.showOnly(activeKinds);
    this.edgeLayer.rebuildAggregated(this.displayedEdges, this.theme, this.camera.scale);
    this.rebuildHighlight();
  }

  /**
   * A relation kind was toggled (spec §8: under 100 ms). Hiding a kind only hides its batch;
   * showing a kind redraws its batch only if it is out of date.
   */
  private updateEdgesForRelationChange(): void {
    this.setHoveredRoute(undefined);
    const activeKinds = this.store.activeRelations;
    this.displayedEdges = computeDisplayedEdges(this.store, this.groupBoxes, this.displayedEdgesOptions());
    const kindsToRedraw = Array.from(activeKinds).filter((kind) => !this.upToDateEdgeKinds.has(kind));
    this.edgeLayer.rebuildBatches(kindsToRedraw, this.displayedEdges, this.theme, this.edgeBuildScale, this.edgeCullRect, this.routingStyle());
    for (const kind of kindsToRedraw) {
      this.upToDateEdgeKinds.add(kind);
    }
    this.edgeLayer.showOnly(activeKinds);
    this.edgeLayer.rebuildAggregated(this.displayedEdges, this.theme, this.edgeBuildScale);
    this.rebuildHighlight();
  }

  private displayedEdgesOptions(): DisplayedEdgesOptions {
    return {
      mergeAllGroups: this.store.mergeRelationsWhenZoomedOut && this.level === 'overview',
      cullRect: this.edgeCullRect,
    };
  }

  /**
   * What a card shows at the current zoom. When the user turned the simplification off,
   * cards are drawn with full detail however far the view is (spec §4.3).
   */
  private cardContentOf(id: string): CardContent {
    const displayMode = this.store.displayModeOf(id);
    if (this.store.simplifyCardsWhenZoomedOut) {
      return cardContentFor(this.level, displayMode);
    }
    return unsimplifiedCardContentFor(this.camera.scale, displayMode);
  }

  private rebuildHighlight(): void {
    const selection = this.store.selection;
    this.edgeLayer.rebuildHighlight(selection, this.store.activeRelations, this.theme, this.edgeBuildScale, this.store.showsSelectionInterface);
    this.edgeLayer.setDimmed(selection.size > 0);
  }

  private routingStyle(): RoutingStyle {
    return routingStyleForLayout(this.store.layout);
  }

  private focusedIdsOrNull(): Set<string> | null {
    return this.store.selection.size === 0 ? null : this.store.focusedNodeIds();
  }

  /** Places the camera the first time a graph is shown, then tells the extension host. */
  private showLoadedDiagram(): void {
    this.isWaitingToShowDiagram = false;
    if (!this.hasPlacedCamera) {
      this.hasPlacedCamera = true;
      if (this.store.camera !== undefined) {
        this.camera.setState(this.store.camera);
        this.markCameraMoved();
      } else {
        this.fitToView(false);
      }
    }
    this.callbacks.onDiagramShown(this.store.visibleNodeIds.size);
  }

  // ---------------------------------------------------------------------------
  // Animation between two layouts (spec §4.4)
  // ---------------------------------------------------------------------------

  private startLayoutAnimation(fitView: boolean): void {
    // The group boxes of the new arrangement say which cards are shown and what to fit.
    this.groupBoxes = computeGroupBoxes(this.store);
    const from = new Map<string, Point>();
    for (const id of this.store.visibleNodeIds) {
      const view = this.cardLayer.view(id);
      // A card that was hidden (by a filter, for example) appears at its new place instead of flying in.
      if (view !== undefined && view.container.visible) {
        from.set(id, { x: view.container.x, y: view.container.y });
      }
    }
    this.animation ={ from, to: new Map(this.store.positions), startTime: performance.now() };
    this.edgeLayer.setVisible(false);
    this.groupLayer.boxContainer.visible = false;
    this.groupLayer.titleContainer.visible = false;
    this.groupLayer.collapsedContainer.visible = false;
    // Every card is drawn during the animation, so their content is reduced to plain rectangles.
    this.cardLayer.updateCulling(new Set(), (id) => this.cardContentOf(id));
    this.cardLayer.syncShown((id) => isCardShown(this.store, this.groupBoxes, id), this.animation.to);
    const bounds = this.shownBounds();
    if (fitView && bounds !== undefined) {
      this.camera.animateTo(this.camera.stateToFit(bounds, this.viewInsets()), LAYOUT_ANIMATION_MS);
    }
  }

  private stepLayoutAnimation(now: number): void {
    const animation = this.animation!;
    const progress = Math.min(1, (now - animation.startTime) / LAYOUT_ANIMATION_MS);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const current = new Map<string, Point>();
    for (const [id, target] of animation.to) {
      const start = animation.from.get(id) ?? target;
      current.set(id, { x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased });
    }
    this.cardLayer.syncPositions(animation.to, current);
    for (const id of this.store.visibleNodeIds) {
      const card = this.cardLayer.view(id);
      if (card !== undefined && card.container.visible) {
        card.container.renderable = true;
      }
    }
    if (progress >= 1) {
      this.animation = undefined;
      this.edgeLayer.setVisible(true);
      this.groupLayer.boxContainer.visible = true;
      this.groupLayer.titleContainer.visible = true;
      this.groupLayer.collapsedContainer.visible = true;
      this.dirty.add('positions');
      this.markCameraMoved();
    }
  }

  // ---------------------------------------------------------------------------
  // Hit-testing helpers for the pointer interaction
  // ---------------------------------------------------------------------------

  private rowAt(cardId: string, worldPoint: Point): CardRow | undefined {
    const position = this.store.positions.get(cardId);
    const view = this.cardLayer.view(cardId);
    if (position === undefined || view === undefined) {
      return undefined;
    }
    return view.rowAt(worldPoint.y - position.y);
  }

  private cardIdsInRect(rect: Rect): string[] {
    return this.spatialIndex
      .search(rect)
      .map((item) => item.target)
      .filter((target): target is Extract<HitTarget, { kind: 'card' }> => target.kind === 'card')
      .map((target) => target.id);
  }

  private drawSelectionRectangle(rect: Rect | undefined): void {
    this.selectionRectangle.clear();
    if (rect !== undefined) {
      this.selectionRectangle
        .roundRect(rect.x, rect.y, rect.width, rect.height, 8 / this.camera.scale)
        .fill({ color: this.theme.accent, alpha: 0.12 })
        .stroke({ width: 1 / this.camera.scale, color: this.theme.accent });
    }
  }

  /** The arrow under a point of the diagram. Cards and group titles hide the arrows behind them. */
  private routeAt(world: Point): RoutedEdge | undefined {
    if (this.spatialIndex.hitTest(world) !== undefined) {
      return undefined;
    }
    const tolerance = EDGE_HIT_TOLERANCE_PIXELS / this.camera.scale;
    return this.edgeLayer.routeAt(world, tolerance, this.store.activeRelations, this.store.selection);
  }

  /**
   * What the pointer is over: the arrow under it is highlighted, and a tooltip shows the
   * relation of an arrow, the qualified name of a card when its text is not readable, or the
   * counts of a merged link.
   */
  private updateHover(world: Point, screen: Point): void {
    const target = this.spatialIndex.hitTest(world);
    const route = this.routeAt(world);
    this.setHoveredRoute(route);
    let text: string | undefined;
    if (target?.target.kind === 'card' && this.level !== 'full') {
      text = target.target.id;
    } else if (route !== undefined) {
      text = this.relationText(route.edge);
    } else if (target === undefined) {
      text = this.aggregatedLinkTextAt(world);
    }
    if (text === undefined) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.hidden = false;
    // Below and to the right of the pointer, or on the other side when it would leave the view.
    const gap = 14;
    const fitsOnTheRight = screen.x + gap + this.tooltip.offsetWidth <= this.camera.viewWidth;
    const fitsBelow = screen.y + gap + this.tooltip.offsetHeight <= this.camera.viewHeight;
    const left = fitsOnTheRight ? screen.x + gap : screen.x - gap - this.tooltip.offsetWidth;
    const top = fitsBelow ? screen.y + gap : screen.y - gap - this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${Math.max(0, top)}px`;
  }

  private clearHover(): void {
    this.setHoveredRoute(undefined);
    this.tooltip.hidden = true;
  }

  private setHoveredRoute(route: RoutedEdge | undefined): void {
    if (route === this.hoveredRoute) {
      return;
    }
    this.hoveredRoute = route;
    this.edgeLayer.setHovered(route, this.theme, this.edgeBuildScale);
    // The hand cursor says that a click does something here.
    this.app.canvas.style.cursor = route === undefined ? '' : 'pointer';
  }

  /** For the tooltip of an arrow: `Composition: Engine → Timer · click to open engine.h:12`. */
  private relationText(edge: Edge): string {
    const nameOf = (id: string) => this.store.nodeById.get(id)?.name ?? id;
    // A click opens the first declaration of the relation.
    const declaration = edge.declarations[0];
    const filePath = this.store.graph?.files[declaration.file] ?? '';
    const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
    return `${RELATION_LABELS[edge.kind]}: ${nameOf(edge.from)} \u2192 ${nameOf(edge.to)} \u00b7 click to open ${fileName}:${declaration.line}`;
  }

  private aggregatedLinkTextAt(world: Point): string | undefined {
    const tolerance = 6 / this.camera.scale;
    for (const link of this.displayedEdges.aggregated) {
      const { start, end } = edgeSegment(link.source, link.target);
      if (distanceToSegment(world, start, end) <= tolerance) {
        const details = (Object.entries(link.countsByKind) as [RelationKind, number][])
          .map(([kind, count]) => `${kind}: ${count}`)
          .join(', ');
        return `${link.total} relations (${details})`;
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Minimap, resize, bounds
  // ---------------------------------------------------------------------------

  private updateMinimap(): void {
    const shapes = [];
    for (const box of this.groupBoxes.values()) {
      shapes.push({ rect: box.isCollapsed ? box.collapsedRect : box.rect, color: groupColor(this.theme, box.key), isGroup: true });
    }
    for (const id of this.store.visibleNodeIds) {
      const rect = cardRect(this.store, id);
      if (rect !== undefined && isCardShown(this.store, this.groupBoxes, id)) {
        shapes.push({ rect, color: groupColor(this.theme, this.store.groupKeyByNode.get(id) ?? ''), isGroup: false });
      }
    }
    this.minimap.setShapes(shapes, this.theme);
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    // The pixel density is read again: it changes with the zoom level of VS Code. The text is
    // then redrawn for it when the camera settles.
    this.app.renderer.resize(width, height, window.devicePixelRatio || 1);
    this.camera.setViewSize(width, height);
    this.markCameraMoved();
  }

  /**
   * The parts of the view covered by the floating panels, which "fit to view" must avoid.
   * These sizes match the layout of styles.css: top bars, side panel, interface panel, bottom pills and minimap.
   */
  private viewInsets(): ViewInsets {
    // In a narrow view the side panel and the panel on the right leave no room between them:
    // the panel on the right, which is the one opened for a short time, is then ignored.
    const isRightPanelShown = this.store.showsRightPanel && this.camera.viewWidth > 900;
    return { left: this.store.isSidePanelOpen ? 296 : 24, top: 72, right: isRightPanelShown ? 408 : 24, bottom: 64 };
  }

  private shownBounds(): Rect | undefined {
    const rects: Rect[] = [];
    for (const id of this.store.visibleNodeIds) {
      const rect = cardRect(this.store, id);
      if (rect !== undefined && isCardShown(this.store, this.groupBoxes, id)) {
        rects.push(rect);
      }
    }
    for (const box of this.groupBoxes.values()) {
      rects.push(box.isCollapsed ? box.collapsedRect : box.rect);
    }
    return unionOfRects(rects);
  }

  // ---------------------------------------------------------------------------
  // PNG export (spec §4.7)
  // ---------------------------------------------------------------------------

  /** Returns the PNG image as base64 text, without the `data:` prefix. */
  async exportPng(scope: Exclude<ExportScope, 'selection'>, scale: number): Promise<string> {
    const canvas = scope === 'view' ? this.renderViewToCanvas(scale) : this.renderDiagramToCanvas(scale);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }

  private renderViewToCanvas(scale: number): HTMLCanvasElement {
    const frame = new Rectangle(0, 0, this.camera.viewWidth, this.camera.viewHeight);
    // The image has `scale` pixels per screen pixel: the text is drawn sharp for that density.
    this.drawTextFor(this.camera.scale, scale);
    try {
      return this.app.renderer.extract.canvas({
        target: this.app.stage,
        frame,
        resolution: scale,
        clearColor: this.theme.background,
      }) as HTMLCanvasElement;
    } finally {
      this.drawTextFor(this.camera.scale, this.app.renderer.resolution);
    }
  }

  /**
   * Renders the whole diagram with full detail. A large diagram does not fit in one
   * GPU texture, so it is rendered in tiles that are assembled in a 2D canvas.
   */
  private renderDiagramToCanvas(requestedScale: number): HTMLCanvasElement {
    const shownBounds = expandRect(this.shownBounds() ?? { x: 0, y: 0, width: 1, height: 1 }, 40);
    // Browsers limit canvases to about 16384 pixels per side and 268 million pixels in total.
    const maxSide = 16384;
    const maxArea = 200_000_000;
    const scale = Math.min(
      requestedScale,
      maxSide / shownBounds.width,
      maxSide / shownBounds.height,
      Math.sqrt(maxArea / (shownBounds.width * shownBounds.height)),
    );
    // The image starts on a whole pixel of the world at this scale: text, which is placed on
    // whole pixels, then falls on the pixels of the image.
    const bounds = {
      ...shownBounds,
      x: Math.floor(shownBounds.x * scale) / scale,
      y: Math.floor(shownBounds.y * scale) / scale,
    };
    const output = document.createElement('canvas');
    output.width = Math.ceil(bounds.width * scale);
    output.height = Math.ceil(bounds.height * scale);
    const context = output.getContext('2d')!;

    const savedCamera = this.camera.state;
    const savedLevel = this.level;
    this.level = 'full';
    // The world is drawn at a zoom of 1, with `scale` pixels per world unit.
    this.drawTextFor(1, scale);
    this.cardLayer.enterExportMode(this.store);
    this.edgeLayer.setLabelsReadable(true);
    this.groupLayer.updateTitleScale(1);
    this.displayedEdges = computeDisplayedEdges(this.store, this.groupBoxes);
    this.edgeLayer.rebuildBatches(this.store.activeRelations, this.displayedEdges, this.theme, scale, undefined, this.routingStyle());
    this.edgeLayer.rebuildAggregated(this.displayedEdges, this.theme, scale);
    this.rebuildHighlight();
    // Render in world coordinates: the camera transform is removed while exporting.
    this.world.position.set(0, 0);
    this.world.scale.set(1);
    try {
      const tileWorldSize = 4096 / scale;
      for (let tileY = bounds.y; tileY < bounds.y + bounds.height; tileY += tileWorldSize) {
        for (let tileX = bounds.x; tileX < bounds.x + bounds.width; tileX += tileWorldSize) {
          const frame = new Rectangle(
            tileX,
            tileY,
            Math.min(tileWorldSize, bounds.x + bounds.width - tileX),
            Math.min(tileWorldSize, bounds.y + bounds.height - tileY),
          );
          const tile = this.app.renderer.extract.canvas({
            target: this.world,
            frame,
            resolution: scale,
            clearColor: this.theme.background,
          }) as HTMLCanvasElement;
          context.drawImage(tile, Math.round((tileX - bounds.x) * scale), Math.round((tileY - bounds.y) * scale));
        }
      }
    } finally {
      this.cardLayer.leaveExportMode();
      this.edgeLayer.setLabelsReadable(savedLevel === 'full');
      this.level = savedLevel;
      this.camera.setState(savedCamera);
      this.drawTextFor(savedCamera.scale, this.app.renderer.resolution);
      this.dirty.add('positions');
      this.markCameraMoved();
    }
    return output;
  }
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    rectContainsPoint(outer, { x: inner.x, y: inner.y }) &&
    rectContainsPoint(outer, { x: inner.x + inner.width, y: inner.y + inner.height })
  );
}

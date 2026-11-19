// The state of the diagram in the webview, and every action that changes it.
//
// This is the single source of truth of the webview: the renderer draws what
// is here and the user interface displays and edits it. Each action changes
// some fields, then calls `emit` with the "topics" that changed, so that the
// renderer only redoes the work that is needed (for example, toggling a
// relation kind only redraws the edges).

import { ClassNode, Graph, RelationKind, ScanReport } from '../../shared/graphModel';
import { DiagramSettings } from '../../shared/messages';
import {
  CameraState,
  DiagramFilters,
  DisplayMode,
  GroupingKind,
  LayoutKind,
  Point,
  SavedDiagramState,
  createDefaultState,
} from '../../shared/savedState';
import { LayoutInput } from '../layout/layoutTypes';
import { CardLayout, FontMetrics, computeCardLayout, footprintForDisplayMode } from '../model/cardGeometry';
import { groupKeyOf } from '../model/groups';
import { pushOverlappingCards } from '../model/overlap';
import { placeNewItems } from '../model/placement';
import { IsolationState, computeVisibleNodeIds, findNeighborhood } from '../model/visibility';

export type ChangeTopic =
  /** A new graph was loaded: everything must be rebuilt. */
  | 'graph'
  | 'positions'
  /** Card sizes or display modes changed. */
  | 'cards'
  | 'relations'
  | 'visibility'
  /** Grouping or collapsed groups changed. */
  | 'groups'
  | 'selection'
  | 'camera'
  /** User interface only: phase, search, menus, panels. */
  | 'ui';

export interface StoreChange {
  topics: Set<ChangeTopic>;
  /** Positions changed for a new layout: the renderer animates the cards to their new place. */
  animatePositions?: boolean;
}

export type DiagramPhase = 'waiting' | 'scanning' | 'layouting' | 'ready' | 'failed';

export type LevelOfDetail = 'overview' | 'compact' | 'full';

export interface ContextMenuState {
  screenX: number;
  screenY: number;
  nodeId?: string;
  groupKey?: string;
}

/** Computes layouts; implemented by LayoutClient, which runs them in a web worker. */
export interface LayoutService {
  compute(input: LayoutInput): Promise<{ positions: Record<string, Point>; durationMs: number }>;
}

type Listener = (change: StoreChange) => void;

const PERSISTED_TOPICS: ChangeTopic[] = ['positions', 'cards', 'relations', 'visibility', 'groups', 'camera'];

export class DiagramStore {
  // ---- Data received from the extension host ----
  graph: Graph | undefined;
  report: ScanReport | undefined;
  settings: DiagramSettings = { maxMembersInAutoMode: 12, structuralRelations: ['inherit', 'compose'] };
  nodeById = new Map<string, ClassNode>();

  // ---- Arrangement, saved in the workspace ----
  layout: LayoutKind = 'grouped';
  grouping: GroupingKind = 'namespace';
  private positionsByLayout = new Map<LayoutKind, Map<string, Point>>();
  private positionsGrouping: Partial<Record<LayoutKind, GroupingKind>> = {};
  displayModes = new Map<string, 'compact' | 'full'>();
  collapsedGroups = new Set<string>();
  activeRelations = new Set<RelationKind>(['inherit']);
  filters: DiagramFilters = createDefaultState().filters;
  camera: CameraState | undefined;

  // ---- Derived data, recomputed when its inputs change ----
  cardLayouts = new Map<string, CardLayout>();
  groupKeyByNode = new Map<string, string>();
  visibleNodeIds = new Set<string>();

  // ---- Session state, not saved ----
  phase: DiagramPhase = 'waiting';
  scanProgress = { parsedFileCount: 0, totalFileCount: 0 };
  failureMessage = '';
  selection = new Set<string>();
  isolation: IsolationState | null = null;
  isolationDepth = 1;
  levelOfDetail: LevelOfDetail = 'compact';
  contextMenu: ContextMenuState | null = null;
  isSidePanelOpen = true;
  lastLayoutDurationMs = 0;

  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly metrics: FontMetrics,
    private readonly layoutService: LayoutService,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static isPersistedChange(change: StoreChange): boolean {
    return PERSISTED_TOPICS.some((topic) => change.topics.has(topic));
  }

  /** Positions of the cards in the current layout. */
  get positions(): Map<string, Point> {
    let positions = this.positionsByLayout.get(this.layout);
    if (positions === undefined) {
      positions = new Map();
      this.positionsByLayout.set(this.layout, positions);
    }
    return positions;
  }

  /** Group boxes and collapsing only exist in the grouped layout; elsewhere groups are shown by color. */
  get hasGroupBoxes(): boolean {
    return this.layout === 'grouped' && this.grouping !== 'none';
  }

  displayModeOf(id: string): DisplayMode {
    return this.displayModes.get(id) ?? 'auto';
  }

  // ---------------------------------------------------------------------------
  // Messages from the extension host
  // ---------------------------------------------------------------------------

  startScan(): void {
    this.phase = 'scanning';
    this.scanProgress = { parsedFileCount: 0, totalFileCount: 0 };
    this.emit(['ui']);
  }

  setScanProgress(parsedFileCount: number, totalFileCount: number): void {
    this.scanProgress = { parsedFileCount, totalFileCount };
    this.emit(['ui']);
  }

  failScan(message: string): void {
    this.phase = this.graph === undefined ? 'failed' : 'ready';
    this.failureMessage = message;
    this.emit(['ui']);
  }

  /**
   * Loads a new graph. On the first load the saved state comes from the host;
   * on a rescan the current state is kept, because it may be newer than the saved file.
   */
  async loadGraph(graph: Graph, report: ScanReport, savedState: SavedDiagramState | undefined, settings: DiagramSettings): Promise<void> {
    const state = this.graph !== undefined ? this.toSavedState() : (savedState ?? createDefaultState());
    this.graph = graph;
    this.report = report;
    this.settings = settings;
    this.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    this.applySavedState(state);
    this.selection = new Set(Array.from(this.selection).filter((id) => this.nodeById.has(id)));
    if (this.isolation !== null && !this.nodeById.has(this.isolation.nodeId)) {
      this.isolation = null;
    }
    this.recomputeGroupKeys();
    this.recomputeAllCardLayouts();
    this.recomputeVisibility();

    const savedPositionsMatch = this.positions.size > 0 && this.positionsGrouping[this.layout] === this.grouping;
    if (savedPositionsMatch) {
      this.placeCardsWithoutPosition();
      this.phase = 'ready';
      this.emit(['graph', 'positions', 'cards', 'relations', 'visibility', 'groups', 'selection', 'ui']);
    } else {
      this.emit(['graph', 'cards', 'relations', 'visibility', 'groups', 'selection', 'ui']);
      await this.computeLayout(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  /** Computes the current layout from scratch, which discards the manual moves of this layout. */
  async computeLayout(animate: boolean): Promise<void> {
    if (this.graph === undefined) {
      return;
    }
    const layout = this.layout;
    const grouping = this.grouping;
    this.phase = 'layouting';
    this.emit(['ui']);
    try {
      const result = await this.layoutService.compute(this.buildLayoutInput());
      this.positionsByLayout.set(layout, new Map(Object.entries(result.positions)));
      this.positionsGrouping[layout] = grouping;
      this.lastLayoutDurationMs = result.durationMs;
      this.phase = 'ready';
      this.emit(['positions', 'groups', 'ui'], layout === this.layout && animate);
    } catch (error) {
      this.phase = 'ready';
      this.failureMessage = `The layout failed: ${error instanceof Error ? error.message : String(error)}`;
      this.emit(['ui']);
    }
  }

  async setLayout(layout: LayoutKind): Promise<void> {
    if (layout === this.layout) {
      return;
    }
    this.layout = layout;
    this.collapsedGroups.clear();
    const hasPositions = this.positions.size > 0 && this.positionsGrouping[layout] === this.grouping;
    if (hasPositions) {
      this.placeCardsWithoutPosition();
      this.emit(['positions', 'groups', 'ui'], true);
    } else {
      await this.computeLayout(true);
    }
  }

  async setGrouping(grouping: GroupingKind): Promise<void> {
    if (grouping === this.grouping) {
      return;
    }
    this.grouping = grouping;
    this.collapsedGroups.clear();
    this.recomputeGroupKeys();
    if (this.layout === 'grouped') {
      await this.computeLayout(true);
    } else {
      // The other layouts do not depend on groups: only the colors change.
      this.positionsGrouping[this.layout] = grouping;
      this.emit(['groups', 'ui']);
    }
  }

  private buildLayoutInput(): LayoutInput {
    const structural = new Set(this.settings.structuralRelations);
    const nodes = this.graph!.nodes
      .filter((node) => !node.isExternal || this.filters.showExternal)
      .map((node) => {
        const card = this.cardLayouts.get(node.id)!;
        return { id: node.id, width: card.width, height: card.height, group: this.groupKeyByNode.get(node.id) ?? '' };
      });
    const edges = this.graph!.edges.filter((edge) => structural.has(edge.kind));
    return { kind: this.layout, nodes, edges };
  }

  /** Gives a position to visible cards that have none, next to their group (spec §6). */
  private placeCardsWithoutPosition(): void {
    const positions = this.positions;
    const toItem = (id: string) => {
      const card = this.cardLayouts.get(id)!;
      return { id, group: this.groupKeyByNode.get(id) ?? '', width: card.width, height: card.height };
    };
    const missing = Array.from(this.visibleNodeIds).filter((id) => !positions.has(id)).map(toItem);
    if (missing.length === 0) {
      return;
    }
    const placed = Array.from(positions.keys()).filter((id) => this.nodeById.has(id)).map(toItem);
    for (const [id, position] of placeNewItems(missing, placed, positions)) {
      positions.set(id, position);
    }
  }

  // ---------------------------------------------------------------------------
  // Display modes (spec §4.3)
  // ---------------------------------------------------------------------------

  setDisplayMode(ids: string[], mode: DisplayMode): void {
    const grownIds: string[] = [];
    for (const id of ids) {
      const node = this.nodeById.get(id);
      if (node === undefined) {
        continue;
      }
      if (mode === 'auto') {
        this.displayModes.delete(id);
      } else {
        this.displayModes.set(id, mode);
      }
      const before = this.cardLayouts.get(id)!;
      const after = this.computeCardLayoutOf(node);
      this.cardLayouts.set(id, after);
      if (after.height > before.height || after.width > before.width) {
        grownIds.push(id);
      }
    }
    // A card that grew pushes its neighbors away; a card that shrank leaves its space until the next layout.
    const moved = pushOverlappingCards(grownIds, this.positions, this.visibleCardBoxes());
    for (const [id, position] of moved) {
      this.positions.set(id, position);
    }
    this.emit(moved.size > 0 ? ['cards', 'positions'] : ['cards']);
  }

  /** Double-click on a card: auto, then full, then compact, then auto again. */
  cycleDisplayMode(id: string): void {
    const next: Record<DisplayMode, DisplayMode> = { auto: 'full', full: 'compact', compact: 'auto' };
    this.setDisplayMode([id], next[this.displayModeOf(id)]);
  }

  setAllDisplayModes(mode: DisplayMode): void {
    this.setDisplayMode(this.graph?.nodes.map((node) => node.id) ?? [], mode);
  }

  private visibleCardBoxes(): { id: string; width: number; height: number }[] {
    return Array.from(this.visibleNodeIds, (id) => {
      const card = this.cardLayouts.get(id)!;
      return { id, width: card.width, height: card.height };
    });
  }

  // ---------------------------------------------------------------------------
  // Relations, filters, groups, isolation (spec §3, §4.5, §4.6)
  // ---------------------------------------------------------------------------

  toggleRelation(kind: RelationKind): void {
    if (this.activeRelations.has(kind)) {
      this.activeRelations.delete(kind);
    } else {
      this.activeRelations.add(kind);
    }
    if (this.isolation !== null) {
      // The neighborhood depends on the active relations.
      this.recomputeVisibility();
      this.emit(['relations', 'visibility']);
    } else {
      this.emit(['relations']);
    }
  }

  setFilters(filters: Partial<DiagramFilters>): void {
    this.filters = { ...this.filters, ...filters };
    this.recomputeVisibility();
    this.placeCardsWithoutPosition();
    this.emit(['visibility', 'positions']);
  }

  toggleGroupCollapsed(groupKey: string): void {
    if (!this.hasGroupBoxes) {
      return;
    }
    if (this.collapsedGroups.has(groupKey)) {
      this.collapsedGroups.delete(groupKey);
    } else {
      this.collapsedGroups.add(groupKey);
    }
    this.emit(['groups']);
  }

  isolate(nodeId: string): void {
    this.isolation = { nodeId, depth: this.isolationDepth };
    this.recomputeVisibility();
    this.emit(['visibility', 'ui']);
  }

  clearIsolation(): void {
    if (this.isolation === null) {
      return;
    }
    this.isolation = null;
    this.recomputeVisibility();
    this.emit(['visibility', 'ui']);
  }

  setIsolationDepth(depth: number): void {
    this.isolationDepth = Math.min(5, Math.max(1, Math.round(depth)));
    if (this.isolation !== null) {
      this.isolation = { ...this.isolation, depth: this.isolationDepth };
      this.recomputeVisibility();
      this.emit(['visibility', 'ui']);
    } else {
      this.emit(['ui']);
    }
  }

  /** The selected classes and their direct neighbors through the active relations (spec §4.6, focus). */
  focusedNodeIds(): Set<string> {
    const focused = new Set<string>();
    if (this.graph === undefined) {
      return focused;
    }
    for (const id of this.selection) {
      for (const neighbor of findNeighborhood(id, 1, this.graph.edges, this.activeRelations)) {
        focused.add(neighbor);
      }
    }
    return focused;
  }

  // ---------------------------------------------------------------------------
  // Selection and moves
  // ---------------------------------------------------------------------------

  select(ids: string[], mode: 'replace' | 'toggle' | 'add'): void {
    if (mode === 'replace') {
      this.selection = new Set(ids);
    } else {
      for (const id of ids) {
        if (mode === 'toggle' && this.selection.has(id)) {
          this.selection.delete(id);
        } else {
          this.selection.add(id);
        }
      }
    }
    this.emit(['selection']);
  }

  clearSelection(): void {
    if (this.selection.size > 0) {
      this.selection = new Set();
      this.emit(['selection']);
    }
  }

  moveNodes(ids: Iterable<string>, deltaX: number, deltaY: number): void {
    const positions = this.positions;
    for (const id of ids) {
      const position = positions.get(id);
      if (position !== undefined) {
        positions.set(id, { x: position.x + deltaX, y: position.y + deltaY });
      }
    }
    this.emit(['positions']);
  }

  /** Called by the renderer when the camera moved; only needed to save it. */
  setCamera(camera: CameraState): void {
    this.camera = camera;
    this.emit(['camera']);
  }

  setLevelOfDetail(level: LevelOfDetail): void {
    if (level !== this.levelOfDetail) {
      this.levelOfDetail = level;
      this.emit(['ui']);
    }
  }

  // ---------------------------------------------------------------------------
  // User interface state
  // ---------------------------------------------------------------------------

  openContextMenu(menu: ContextMenuState | null): void {
    this.contextMenu = menu;
    this.emit(['ui']);
  }

  toggleSidePanel(): void {
    this.isSidePanelOpen = !this.isSidePanelOpen;
    this.emit(['ui']);
  }

  /** Shows a message in the banner above the diagram. */
  showWarning(message: string): void {
    this.failureMessage = message;
    this.emit(['ui']);
  }

  dismissFailure(): void {
    this.failureMessage = '';
    this.emit(['ui']);
  }

  // ---------------------------------------------------------------------------
  // Persistence (spec §6)
  // ---------------------------------------------------------------------------

  toSavedState(): SavedDiagramState {
    const positions: SavedDiagramState['positions'] = {};
    for (const [layout, layoutPositions] of this.positionsByLayout) {
      positions[layout] = Object.fromEntries(layoutPositions);
    }
    return {
      version: 1,
      layout: this.layout,
      grouping: this.grouping,
      positions,
      positionsGrouping: { ...this.positionsGrouping },
      displayModes: Object.fromEntries(this.displayModes),
      collapsedGroups: Array.from(this.collapsedGroups),
      activeRelations: Array.from(this.activeRelations),
      filters: this.filters,
      camera: this.camera,
    };
  }

  private applySavedState(state: SavedDiagramState): void {
    const exists = (id: string) => this.nodeById.has(id);
    this.layout = state.layout;
    this.grouping = state.grouping;
    this.positionsByLayout = new Map();
    for (const [layout, positions] of Object.entries(state.positions)) {
      // Classes that disappeared since the last scan are dropped from the arrangement.
      const kept = Object.entries(positions ?? {}).filter(([id]) => exists(id));
      this.positionsByLayout.set(layout as LayoutKind, new Map(kept));
    }
    this.positionsGrouping = { ...state.positionsGrouping };
    this.displayModes = new Map(Object.entries(state.displayModes).filter(([id]) => exists(id)));
    this.collapsedGroups = new Set(state.collapsedGroups);
    this.activeRelations = new Set(state.activeRelations);
    this.filters = { ...createDefaultState().filters, ...state.filters };
    this.camera = state.camera;
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  private computeCardLayoutOf(node: ClassNode): CardLayout {
    const footprint = footprintForDisplayMode(this.displayModeOf(node.id));
    return computeCardLayout(node, footprint, this.settings.maxMembersInAutoMode, this.metrics);
  }

  private recomputeAllCardLayouts(): void {
    this.cardLayouts = new Map();
    for (const node of this.graph?.nodes ?? []) {
      this.cardLayouts.set(node.id, this.computeCardLayoutOf(node));
    }
  }

  private recomputeGroupKeys(): void {
    this.groupKeyByNode = new Map();
    for (const node of this.graph?.nodes ?? []) {
      this.groupKeyByNode.set(node.id, groupKeyOf(node, this.grouping, this.graph!.files));
    }
  }

  private recomputeVisibility(): void {
    if (this.graph === undefined) {
      this.visibleNodeIds = new Set();
      return;
    }
    this.visibleNodeIds = computeVisibleNodeIds(this.graph, this.filters, this.isolation, this.activeRelations);
  }

  private emit(topics: ChangeTopic[], animatePositions = false): void {
    const change: StoreChange = { topics: new Set(topics), animatePositions };
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}

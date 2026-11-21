// Tests of the webview store and of the layouts, run in Node (elkjs and d3-force work outside the browser).

import { describe, expect, it } from 'vitest';
import { ClassNode, Graph, ScanReport } from '../../src/shared/graphModel';
import { computeLayout } from '../../src/webview/layout/computeLayout';
import { orderByAffinity, packGroups } from '../../src/webview/layout/groupPacking';
import { LayoutInput } from '../../src/webview/layout/layoutTypes';
import { Rect, rectsOverlap } from '../../src/webview/model/geometry';
import { computeDisplayedEdges, computeGroupBoxes } from '../../src/webview/model/sceneGeometry';
import { DiagramStore, LayoutService } from '../../src/webview/state/diagramStore';

const METRICS = { charWidth: 7 };
const SETTINGS = { maxMembersInAutoMode: 12, structuralRelations: ['inherit' as const, 'compose' as const] };

const layoutService: LayoutService = {
  compute: async (input: LayoutInput) => ({ positions: await computeLayout(input), durationMs: 0 }),
  pack: async (packing) => Object.fromEntries(await packGroups(packing.boxes, packing.links)),
};

function makeNode(id: string, namespace: string, memberCount = 2): ClassNode {
  return {
    id,
    name: id.split('::').pop()!,
    kind: 'class',
    namespace,
    file: 0,
    line: 1,
    isAbstract: false,
    isExternal: false,
    attributes: Array.from({ length: memberCount }, (_, index) => ({
      name: `field${index}`,
      signature: 'int',
      visibility: 'private' as const,
      flags: 0,
      file: 0,
      line: index + 2,
    })),
    methods: [],
  };
}

function makeGraph(): Graph {
  return {
    root: '/project',
    files: ['a.h'],
    nodes: [
      makeNode('a::Base', 'a'),
      makeNode('a::Left', 'a'),
      makeNode('a::Right', 'a', 20),
      makeNode('b::Part', 'b'),
      makeNode('b::Other', 'b'),
    ],
    edges: [
      { from: 'a::Left', to: 'a::Base', kind: 'inherit', access: 'public', declarations: [{ file: 0, line: 1 }] },
      { from: 'a::Right', to: 'a::Base', kind: 'inherit', access: 'public', declarations: [{ file: 0, line: 1 }] },
      { from: 'a::Left', to: 'b::Part', kind: 'compose', multiplicity: '1', declarations: [{ file: 0, line: 1 }] },
      { from: 'a::Right', to: 'b::Other', kind: 'depend', declarations: [{ file: 0, line: 1 }] },
    ],
    calls: [],
  };
}

const REPORT = {} as ScanReport;

async function loadedStore(): Promise<DiagramStore> {
  const store = new DiagramStore(METRICS, layoutService);
  await store.loadGraph(makeGraph(), REPORT, undefined, SETTINGS);
  return store;
}

function rectOf(store: DiagramStore, id: string): Rect {
  const position = store.positions.get(id)!;
  const card = store.cardLayouts.get(id)!;
  return { x: position.x, y: position.y, width: card.width, height: card.height };
}

function expectNoOverlap(store: DiagramStore): void {
  const ids = Array.from(store.positions.keys());
  for (const first of ids) {
    for (const second of ids) {
      if (first < second) {
        expect(rectsOverlap(rectOf(store, first), rectOf(store, second)), `${first} and ${second} overlap`).toBe(false);
      }
    }
  }
}

describe('layouts', () => {
  it('places base classes above derived classes, without overlaps, in every layout', async () => {
    const store = await loadedStore();
    for (const layout of ['grouped', 'hierarchy', 'organic'] as const) {
      await store.setLayout(layout);
      expect(store.positions.size).toBe(5);
      expectNoOverlap(store);
      if (layout !== 'organic') {
        expect(store.positions.get('a::Base')!.y).toBeLessThan(store.positions.get('a::Left')!.y);
      }
    }
  });

  it('keeps the members of a group inside its box in the grouped layout', async () => {
    const store = await loadedStore();
    const boxes = computeGroupBoxes(store);
    expect(Array.from(boxes.keys()).sort()).toEqual(['a', 'b']);
    expect(rectsOverlap(boxes.get('a')!.rect, boxes.get('b')!.rect)).toBe(false);
  });
});

describe('store actions', () => {
  it('pins a card to full, grows it and pushes the overlapped cards away', async () => {
    const store = await loadedStore();
    const before = store.cardLayouts.get('a::Right')!.height;
    store.setDisplayMode(['a::Right'], 'full');
    expect(store.displayModeOf('a::Right')).toBe('full');
    expect(store.cardLayouts.get('a::Right')!.height).toBeGreaterThan(before);
    expectNoOverlap(store);
  });

  it('gives a new selection set after each change of the selection', async () => {
    const store = await loadedStore();
    store.select(['a::Base'], 'replace');
    const first = store.selection;
    store.select(['a::Left'], 'add');
    // The user interface compares the sets to know that the selection changed.
    expect(store.selection).not.toBe(first);
    expect(Array.from(store.selection)).toEqual(['a::Base', 'a::Left']);
    store.select(['a::Base'], 'toggle');
    expect(Array.from(store.selection)).toEqual(['a::Left']);
  });

  it('shows the interface of the selection while its panel is open and classes are selected', async () => {
    const store = await loadedStore();
    store.toggleInterfacePanel();
    expect(store.showsSelectionInterface).toBe(false);
    store.select(['a::Base'], 'replace');
    expect(store.showsSelectionInterface).toBe(true);
    store.clearSelection();
    expect(store.showsSelectionInterface).toBe(false);
  });

  it('cycles the display mode on Alt + double-click', async () => {
    const store = await loadedStore();
    const modes = [];
    for (let step = 0; step < 3; step++) {
      store.cycleDisplayMode('a::Base');
      modes.push(store.displayModeOf('a::Base'));
    }
    expect(modes).toEqual(['full', 'compact', 'auto']);
  });

  it('merges the edges of collapsed groups, and of every group only on request', async () => {
    const store = await loadedStore();
    store.toggleRelation('compose');
    const boxes = computeGroupBoxes(store);
    const expanded = computeDisplayedEdges(store, boxes);
    expect(expanded.aggregated).toHaveLength(0);
    expect(expanded.individual).toHaveLength(3);
    const merged = computeDisplayedEdges(store, boxes, { mergeAllGroups: true });
    expect(merged.individual).toHaveLength(0);
    expect(merged.aggregated).toHaveLength(1);

    await store.toggleGroupCollapsed('b');
    const collapsed = computeDisplayedEdges(store, computeGroupBoxes(store));
    expect(collapsed.individual.map((item) => item.edge.kind)).toEqual(['inherit', 'inherit']);
    expect(collapsed.aggregated).toHaveLength(1);
    expect(collapsed.aggregated[0].countsByKind).toEqual({ compose: 1 });
  });

  it('isolates a neighborhood and restores the full diagram', async () => {
    const store = await loadedStore();
    store.isolate('a::Left');
    expect(Array.from(store.visibleNodeIds).sort()).toEqual(['a::Base', 'a::Left']);
    store.setIsolationDepth(2);
    expect(Array.from(store.visibleNodeIds).sort()).toEqual(['a::Base', 'a::Left', 'a::Right']);
    store.clearIsolation();
    expect(store.visibleNodeIds.size).toBe(5);
  });

  it('saves and restores the arrangement, dropping classes that disappeared', async () => {
    const store = await loadedStore();
    store.moveNodes(['a::Base'], 500, 0);
    store.setDisplayMode(['b::Part'], 'compact');
    store.toggleRelation('depend');
    store.setSimplifyCardsWhenZoomedOut(false);
    store.setMergeRelationsWhenZoomedOut(true);
    expect(store.doubleClickOpens).toBe('definition');
    store.setDoubleClickOpens('declaration');
    const saved = JSON.parse(JSON.stringify(store.toSavedState()));

    const graph = makeGraph();
    graph.nodes = graph.nodes.filter((node) => node.id !== 'b::Other');
    graph.nodes.push(makeNode('b::New', 'b'));
    const restored = new DiagramStore(METRICS, layoutService);
    await restored.loadGraph(graph, REPORT, saved, SETTINGS);

    expect(restored.positions.get('a::Base')).toEqual(store.positions.get('a::Base'));
    expect(restored.displayModeOf('b::Part')).toBe('compact');
    expect(restored.activeRelations.has('depend')).toBe(true);
    expect(restored.simplifyCardsWhenZoomedOut).toBe(false);
    expect(restored.mergeRelationsWhenZoomedOut).toBe(true);
    expect(restored.doubleClickOpens).toBe('declaration');
    expect(restored.positions.has('b::Other')).toBe(false);
    // The new class is placed next to its group instead of recomputing the layout.
    expect(restored.positions.has('b::New')).toBe(true);
  });
});

describe('filters', () => {
  async function loadedStoreWithStruct(service: LayoutService = layoutService): Promise<DiagramStore> {
    const graph = makeGraph();
    graph.nodes.find((node) => node.id === 'a::Right')!.kind = 'struct';
    const store = new DiagramStore(METRICS, service);
    await store.loadGraph(graph, REPORT, undefined, SETTINGS);
    return store;
  }

  it('computes the layout again, without the hidden classes, when a "Show" filter changes', async () => {
    const store = await loadedStoreWithStruct();
    await store.setLayout('hierarchy');
    await store.setLayout('grouped');
    store.moveNodes(['a::Base'], 500, 0);
    const moved = store.positions.get('a::Base');

    await store.setFilters({ hiddenEntityKinds: ['struct'] });
    expect(store.visibleNodeIds.has('a::Right')).toBe(false);
    expect(Array.from(store.positions.keys()).sort()).toEqual(['a::Base', 'a::Left', 'b::Other', 'b::Part']);
    expect(store.positions.get('a::Base')).not.toEqual(moved);
    // The other layouts are computed again too, when they are shown.
    await store.setLayout('hierarchy');
    expect(store.positions.has('a::Right')).toBe(false);
    await store.setLayout('grouped');

    await store.setFilters({ hiddenEntityKinds: [] });
    expect(store.positions.size).toBe(5);
    expectNoOverlap(store);
  });

  it('undoes the layout computed for a "Show" filter, which brings the manual moves back', async () => {
    const store = await loadedStoreWithStruct();
    await store.setFilters({ hiddenEntityKinds: ['struct'] });
    store.moveNodes(['a::Base'], 500, 0);
    const moved = store.positions.get('a::Base');

    await store.setFilters({ hiddenEntityKinds: [] });
    store.undo();
    expect(store.positions.get('a::Base')).toEqual(moved);
    // The struct stays shown, so it gets a place in the restored arrangement.
    expect(store.visibleNodeIds.has('a::Right')).toBe(true);
    expect(store.positions.has('a::Right')).toBe(true);
  });

  it('hides a namespace without moving the other classes', async () => {
    const store = await loadedStore();
    const before = new Map(store.positions);
    await store.setFilters({ hiddenNamespaces: ['b'] });
    expect(Array.from(store.visibleNodeIds).sort()).toEqual(['a::Base', 'a::Left', 'a::Right']);
    expect(store.positions).toEqual(before);
  });

  it('keeps the latest layout when an older one ends after it', async () => {
    // A layout service whose results are released by hand, to end them out of order.
    const releases: (() => void)[] = [];
    const manualService: LayoutService = {
      compute: async (input: LayoutInput) => {
        const positions = await computeLayout(input);
        await new Promise<void>((resolve) => releases.push(resolve));
        return { positions, durationMs: 0 };
      },
      pack: layoutService.pack,
    };
    const loading = loadedStoreWithStruct(manualService);
    await waitUntil(() => releases.length === 1);
    releases[0]();
    const store = await loading;

    const hiding = store.setFilters({ hiddenEntityKinds: ['struct'] });
    const showing = store.setFilters({ hiddenEntityKinds: [] });
    await waitUntil(() => releases.length === 3);
    releases[2]();
    releases[1]();
    await Promise.all([hiding, showing]);
    expect(store.phase).toBe('ready');
    expect(store.positions.has('a::Right')).toBe(true);
  });
});

async function waitUntil(condition: () => boolean): Promise<void> {
  while (!condition()) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('undo and redo', () => {
  it('undoes and redoes a move, one step per drag', async () => {
    const store = await loadedStore();
    const before = store.positions.get('a::Base')!;
    expect(store.canUndo).toBe(false);
    // A drag: the pointer interaction records one step, then moves several times.
    store.rememberForUndo();
    store.moveNodes(['a::Base'], 30, 0);
    store.moveNodes(['a::Base'], 30, 10);
    expect(store.positions.get('a::Base')).toEqual({ x: before.x + 60, y: before.y + 10 });

    store.undo();
    expect(store.positions.get('a::Base')).toEqual(before);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.positions.get('a::Base')).toEqual({ x: before.x + 60, y: before.y + 10 });
  });

  it('undoes a display mode change, with the card sizes and the pushed neighbors', async () => {
    const store = await loadedStore();
    const positionsBefore = new Map(store.positions);
    const heightBefore = store.cardLayouts.get('a::Right')!.height;
    store.setDisplayMode(['a::Right'], 'full');
    store.undo();
    expect(store.displayModeOf('a::Right')).toBe('auto');
    expect(store.cardLayouts.get('a::Right')!.height).toBe(heightBefore);
    expect(store.positions).toEqual(positionsBefore);
  });

  it('undoes a recomputed layout, which brings the manual moves back', async () => {
    const store = await loadedStore();
    store.rememberForUndo();
    store.moveNodes(['a::Base'], 500, 0);
    const moved = store.positions.get('a::Base');
    await store.recomputeLayout();
    expect(store.positions.get('a::Base')).not.toEqual(moved);
    store.undo();
    expect(store.positions.get('a::Base')).toEqual(moved);
  });
});

describe('groups', () => {
  it('gives the room of a collapsed group back, and takes it again when expanded', async () => {
    const store = await loadedStore();
    const widthOf = () => {
      const boxes = Array.from(computeGroupBoxes(store).values()).map((box) => (box.isCollapsed ? box.collapsedRect : box.rect));
      return Math.max(...boxes.map((rect) => rect.x + rect.width)) - Math.min(...boxes.map((rect) => rect.x));
    };
    const expandedWidth = widthOf();
    await store.toggleGroupCollapsed('a');
    expect(widthOf()).toBeLessThan(expandedWidth);
    // The collapsed card and the other group do not overlap.
    const boxes = computeGroupBoxes(store);
    expect(rectsOverlap(boxes.get('a')!.collapsedRect, boxes.get('b')!.rect)).toBe(false);

    await store.toggleGroupCollapsed('a');
    expect(widthOf()).toBeCloseTo(expandedWidth, 0);
    expectNoOverlap(store);
  });

  it('recomputes the layout when every card changes its display mode', async () => {
    const store = await loadedStore();
    await store.setAllDisplayModes('full');
    expect(store.displayModeOf('a::Right')).toBe('full');
    expectNoOverlap(store);
    await store.setAllDisplayModes('auto');
    expect(store.displayModes.size).toBe(0);
    store.undo();
    expect(store.displayModeOf('a::Right')).toBe('full');
  });

  it('orders groups so that related groups follow each other', async () => {
    const box = (id: string) => ({ id, width: 100, height: 100 });
    const ordered = orderByAffinity(
      [box('audio'), box('core'), box('net'), box('ui'), box('unrelated')],
      [
        { from: 'core', to: 'ui', weight: 5 },
        { from: 'ui', to: 'audio', weight: 3 },
        { from: 'core', to: 'net', weight: 1 },
      ],
    );
    // `ui` has the most relations; `core` and `audio` follow it; `unrelated` comes last.
    expect(ordered.map((group) => group.id)).toEqual(['ui', 'core', 'audio', 'net', 'unrelated']);
  });

  it('packs the boxes in the order they are given, row by row', async () => {
    const boxes = ['first', 'second', 'third'].map((id) => ({ id, width: 200, height: 100 }));
    const positions = await packGroups(boxes, []);
    const first = positions.get('first')!;
    const second = positions.get('second')!;
    const third = positions.get('third')!;
    const readingOrder = (point: { x: number; y: number }) => point.y * 10_000 + point.x;
    expect(readingOrder(first)).toBeLessThan(readingOrder(second));
    expect(readingOrder(second)).toBeLessThan(readingOrder(third));
  });
});

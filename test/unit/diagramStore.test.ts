// Tests of the webview store and of the layouts, run in Node (elkjs and d3-force work outside the browser).

import { describe, expect, it } from 'vitest';
import { ClassNode, Graph, ScanReport } from '../../src/shared/graphModel';
import { computeLayout } from '../../src/webview/layout/computeLayout';
import { LayoutInput } from '../../src/webview/layout/layoutTypes';
import { Rect, rectsOverlap } from '../../src/webview/model/geometry';
import { computeDisplayedEdges, computeGroupBoxes } from '../../src/webview/model/sceneGeometry';
import { DiagramStore, LayoutService } from '../../src/webview/state/diagramStore';

const METRICS = { charWidth: 7 };
const SETTINGS = { maxMembersInAutoMode: 12, structuralRelations: ['inherit' as const, 'compose' as const] };

const layoutService: LayoutService = {
  compute: async (input: LayoutInput) => ({ positions: await computeLayout(input), durationMs: 0 }),
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
      { from: 'a::Left', to: 'a::Base', kind: 'inherit', access: 'public' },
      { from: 'a::Right', to: 'a::Base', kind: 'inherit', access: 'public' },
      { from: 'a::Left', to: 'b::Part', kind: 'compose', multiplicity: '1' },
      { from: 'a::Right', to: 'b::Other', kind: 'depend' },
    ],
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

  it('cycles the display mode on double-click', async () => {
    const store = await loadedStore();
    const modes = [];
    for (let step = 0; step < 3; step++) {
      store.cycleDisplayMode('a::Base');
      modes.push(store.displayModeOf('a::Base'));
    }
    expect(modes).toEqual(['full', 'compact', 'auto']);
  });

  it('merges the edges between groups at the overview level and for collapsed groups', async () => {
    const store = await loadedStore();
    store.toggleRelation('compose');
    const boxes = computeGroupBoxes(store);
    expect(computeDisplayedEdges(store, boxes, 'full').aggregated).toHaveLength(0);
    const overview = computeDisplayedEdges(store, boxes, 'overview');
    expect(overview.individual).toHaveLength(0);
    expect(overview.aggregated).toHaveLength(1);
    expect(overview.aggregated[0].countsByKind).toEqual({ compose: 1 });

    store.toggleGroupCollapsed('b');
    const collapsed = computeDisplayedEdges(store, computeGroupBoxes(store), 'full');
    expect(collapsed.individual.map((item) => item.edge.kind)).toEqual(['inherit', 'inherit']);
    expect(collapsed.aggregated).toHaveLength(1);
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
    const saved = JSON.parse(JSON.stringify(store.toSavedState()));

    const graph = makeGraph();
    graph.nodes = graph.nodes.filter((node) => node.id !== 'b::Other');
    graph.nodes.push(makeNode('b::New', 'b'));
    const restored = new DiagramStore(METRICS, layoutService);
    await restored.loadGraph(graph, REPORT, saved, SETTINGS);

    expect(restored.positions.get('a::Base')).toEqual(store.positions.get('a::Base'));
    expect(restored.displayModeOf('b::Part')).toBe('compact');
    expect(restored.activeRelations.has('depend')).toBe(true);
    expect(restored.positions.has('b::Other')).toBe(false);
    // The new class is placed next to its group instead of recomputing the layout.
    expect(restored.positions.has('b::New')).toBe(true);
  });
});

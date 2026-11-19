// Tests of the webview model: card geometry, overlaps, placement, visibility and edge geometry.

import { describe, expect, it } from 'vitest';
import { ClassNode, Edge, Graph, MemberFlags } from '../../src/shared/graphModel';
import { createDefaultState } from '../../src/shared/savedState';
import { CARD_STYLE, computeCardLayout } from '../../src/webview/model/cardGeometry';
import { clipSegmentToRect, dashSegments, edgeSegment } from '../../src/webview/model/edgeGeometry';
import { pushOverlappingCards } from '../../src/webview/model/overlap';
import { placeNewItems } from '../../src/webview/model/placement';
import { computeVisibleNodeIds, findNeighborhood } from '../../src/webview/model/visibility';
import { TEXT_MIN_SCALE, cardContentFor, levelOfDetailForScale, unsimplifiedCardContentFor } from '../../src/webview/render/levelOfDetail';

const METRICS = { charWidth: 7 };

function makeNode(id: string, overrides: Partial<ClassNode> = {}): ClassNode {
  const separator = id.lastIndexOf('::');
  return {
    id,
    name: separator === -1 ? id : id.slice(separator + 2),
    kind: 'class',
    namespace: separator === -1 ? '' : id.slice(0, separator),
    file: 0,
    line: 1,
    isAbstract: false,
    isExternal: false,
    attributes: [],
    methods: [],
    ...overrides,
  };
}

function makeMembers(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `member${index}`,
    signature: 'int',
    visibility: 'private' as const,
    flags: 0,
    file: 0,
    line: index + 1,
  }));
}

describe('card geometry', () => {
  it('caps the number of member lines in auto mode and adds a "more" line', () => {
    const node = makeNode('Big', { attributes: makeMembers(20) });
    const layout = computeCardLayout(node, 'capped', 12, METRICS);
    expect(layout.rows).toHaveLength(13);
    expect(layout.rows[12]).toMatchObject({ kind: 'more', text: '+ 8 more' });
  });

  it('shows every member when pinned to full, and only the header when pinned to compact', () => {
    const node = makeNode('Big', { attributes: makeMembers(20) });
    expect(computeCardLayout(node, 'all', 12, METRICS).rows).toHaveLength(20);
    const compact = computeCardLayout(node, 'header', 12, METRICS);
    expect(compact.rows).toHaveLength(0);
    expect(compact.height).toBe(CARD_STYLE.headerHeight);
  });

  it('titles templates with their parameters and badges special kinds', () => {
    const node = makeNode('Buffer', { kind: 'struct', templateParams: ['T', 'N'], isAbstract: true });
    const layout = computeCardLayout(node, 'capped', 12, METRICS);
    expect(layout.title).toBe('Buffer<T, N>');
    expect(layout.badge).toBe('«abstract struct template»');
  });

  it('marks virtual methods as italic and static members as underlined', () => {
    const node = makeNode('Shape', {
      methods: [
        { name: 'area', signature: '() const: double', visibility: 'public', flags: MemberFlags.Virtual, file: 0, line: 3 },
        { name: 'create', signature: '(): Shape*', visibility: 'public', flags: MemberFlags.Static, file: 0, line: 4 },
      ],
    });
    const rows = computeCardLayout(node, 'capped', 12, METRICS).rows;
    expect(rows.map((row) => [row.text, row.isItalic, row.isStatic])).toEqual([
      ['area() const: double', true, false],
      ['create(): Shape*', false, true],
    ]);
  });

  it('widens the card for long lines and truncates very long ones', () => {
    const short = computeCardLayout(makeNode('A'), 'capped', 12, METRICS);
    expect(short.width).toBe(CARD_STYLE.minWidth);
    const longName = 'x'.repeat(100);
    const node = makeNode('A', { attributes: [{ ...makeMembers(1)[0], name: longName }] });
    const layout = computeCardLayout(node, 'capped', 12, METRICS);
    expect(layout.rows[0].text).toHaveLength(CARD_STYLE.maxLineCharacters);
    expect(layout.rows[0].text.endsWith('…')).toBe(true);
    expect(layout.width).toBeGreaterThan(CARD_STYLE.maxLineCharacters * METRICS.charWidth);
  });
});

describe('level of detail', () => {
  it('simplifies cards as the view zooms out', () => {
    expect(levelOfDetailForScale(0.1)).toBe('overview');
    expect(levelOfDetailForScale(0.3)).toBe('compact');
    expect(levelOfDetailForScale(1)).toBe('full');
    expect(cardContentFor('overview', 'full')).toBe('none');
    expect(cardContentFor('compact', 'auto')).toBe('bigName');
    expect(cardContentFor('compact', 'full')).toBe('members');
    expect(cardContentFor('full', 'compact')).toBe('header');
  });

  it('keeps full cards at every zoom when the simplification is off, without invisible text', () => {
    expect(unsimplifiedCardContentFor(1, 'auto')).toBe('members');
    expect(unsimplifiedCardContentFor(TEXT_MIN_SCALE, 'auto')).toBe('members');
    expect(unsimplifiedCardContentFor(0.3, 'compact')).toBe('header');
    expect(unsimplifiedCardContentFor(0.05, 'auto')).toBe('frame');
  });
});

describe('overlaps', () => {
  it('pushes the cards below a grown card down, with a cascade', () => {
    const positions = new Map([
      ['grown', { x: 0, y: 0 }],
      ['below', { x: 0, y: 120 }],
      ['further', { x: 0, y: 240 }],
      ['aside', { x: 500, y: 0 }],
    ]);
    const boxes = [
      { id: 'grown', width: 200, height: 300 },
      { id: 'below', width: 200, height: 100 },
      { id: 'further', width: 200, height: 100 },
      { id: 'aside', width: 200, height: 100 },
    ];
    const moved = pushOverlappingCards(['grown'], positions, boxes);
    expect(moved.get('below')).toEqual({ x: 0, y: 320 });
    expect(moved.get('further')).toEqual({ x: 0, y: 440 });
    expect(moved.has('aside')).toBe(false);
  });
});

describe('placement of new classes', () => {
  it('places a new class to the right of its group, and an orphan to the right of everything', () => {
    const positions = new Map([
      ['a1', { x: 0, y: 0 }],
      ['a2', { x: 0, y: 200 }],
      ['b1', { x: 1000, y: 0 }],
    ]);
    const placed = [
      { id: 'a1', group: 'a', width: 200, height: 100 },
      { id: 'a2', group: 'a', width: 200, height: 100 },
      { id: 'b1', group: 'b', width: 200, height: 100 },
    ];
    const newItems = [
      { id: 'a3', group: 'a', width: 200, height: 100 },
      { id: 'a4', group: 'a', width: 200, height: 100 },
      { id: 'c1', group: 'c', width: 200, height: 100 },
    ];
    const result = placeNewItems(newItems, placed, positions);
    expect(result.get('a3')).toEqual({ x: 230, y: 0 });
    expect(result.get('a4')).toEqual({ x: 230, y: 130 });
    expect(result.get('c1')!.x).toBeGreaterThan(1200);
  });
});

describe('visibility and isolation', () => {
  const graph: Graph = {
    root: '/project',
    files: ['src/a.h', 'lib/b.h'],
    nodes: [
      makeNode('app::A'),
      makeNode('app::B', { kind: 'struct' }),
      makeNode('lib::C', { file: 1 }),
      makeNode('lib::D', { file: 1, templateParams: ['T'] }),
      makeNode('Fwd', { isExternal: true }),
    ],
    edges: [
      { from: 'app::B', to: 'app::A', kind: 'inherit' },
      { from: 'lib::C', to: 'app::B', kind: 'compose' },
      { from: 'lib::D', to: 'lib::C', kind: 'depend' },
    ] satisfies Edge[],
  };
  const filters = createDefaultState().filters;

  it('hides forward-declared classes by default', () => {
    const visible = computeVisibleNodeIds(graph, filters, null, new Set(['inherit']));
    expect(Array.from(visible).sort()).toEqual(['app::A', 'app::B', 'lib::C', 'lib::D']);
  });

  it('filters by entity kind, templates, namespace and folder', () => {
    const hideStructsAndTemplates = { ...filters, hiddenEntityKinds: ['struct', 'template'] };
    expect(Array.from(computeVisibleNodeIds(graph, hideStructsAndTemplates, null, new Set())).sort()).toEqual(['app::A', 'lib::C']);
    expect(Array.from(computeVisibleNodeIds(graph, { ...filters, hiddenNamespaces: ['app'] }, null, new Set())).sort()).toEqual([
      'lib::C',
      'lib::D',
    ]);
    expect(Array.from(computeVisibleNodeIds(graph, { ...filters, hiddenFolders: ['lib'] }, null, new Set())).sort()).toEqual([
      'app::A',
      'app::B',
    ]);
  });

  it('isolates a neighborhood through the active relations only', () => {
    const active = new Set(['inherit', 'compose'] as const);
    expect(Array.from(findNeighborhood('app::A', 1, graph.edges, new Set(active))).sort()).toEqual(['app::A', 'app::B']);
    expect(Array.from(findNeighborhood('app::A', 2, graph.edges, new Set(active))).sort()).toEqual(['app::A', 'app::B', 'lib::C']);
    const isolated = computeVisibleNodeIds(graph, filters, { nodeId: 'lib::D', depth: 5 }, new Set(active));
    expect(Array.from(isolated)).toEqual(['lib::D']);
  });
});

describe('edge geometry', () => {
  it('clips an edge to the borders of both cards', () => {
    const segment = edgeSegment({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 0, width: 100, height: 100 });
    expect(segment.start).toEqual({ x: 100, y: 50 });
    expect(segment.end).toEqual({ x: 300, y: 50 });
  });

  it('clips a segment to a rectangle', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(clipSegmentToRect({ start: { x: -5, y: 5 }, end: { x: 15, y: 5 } }, rect)).toEqual({ start: { x: 0, y: 5 }, end: { x: 10, y: 5 } });
    expect(clipSegmentToRect({ start: { x: -5, y: 20 }, end: { x: 15, y: 20 } }, rect)).toBeUndefined();
  });

  it('splits a segment into dashes, with a cap on their number', () => {
    expect(dashSegments({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, 6, 4)).toHaveLength(10);
    expect(dashSegments({ start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 } }, 6, 4).length).toBeLessThanOrEqual(401);
  });
});

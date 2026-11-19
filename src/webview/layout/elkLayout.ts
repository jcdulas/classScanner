// Runs ELK (Eclipse Layout Kernel) on a set of cards.
//
// ELK is a Java library compiled to JavaScript (the `elkjs` package). Its
// "layered" algorithm, also known as Sugiyama layout, arranges nodes in
// horizontal layers so that edges point downward, which is the classic look
// of a UML class diagram. Its "rectpacking" algorithm packs boxes into a
// compact rectangle, which is used to place the groups next to each other.

import ELK, { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk.bundled.js';
import { Point } from '../../shared/savedState';

export interface Box {
  id: string;
  width: number;
  height: number;
}

export interface DirectedLink {
  /** Drawn above `to`. */
  from: string;
  to: string;
}

const elk = new ELK();

/** ELK adds a margin of 12 units around a layout by default; positions here start at (0, 0). */
const NO_PADDING = '[top=0,left=0,bottom=0,right=0]';

const LAYERED_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.padding': NO_PADDING,
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  // Unconnected parts of the graph are laid out separately, then packed with this aspect ratio.
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '50',
  'elk.aspectRatio': '1.6',
  // Edge routes are not used (the renderer draws straight lines), so the cheapest routing is enough.
  'elk.edgeRouting': 'POLYLINE',
};

const PACKING_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'rectpacking',
  'elk.padding': NO_PADDING,
  'elk.aspectRatio': '1.6',
  'elk.spacing.nodeNode': '60',
};

/** Layered layout: returns the top-left corner of each box, starting near (0, 0). */
export async function layeredLayout(boxes: Box[], links: DirectedLink[]): Promise<Map<string, Point>> {
  return runElk(boxes, links, LAYERED_OPTIONS);
}

/** Packs boxes into a compact rectangle, keeping their order roughly row by row. */
export async function packBoxes(boxes: Box[]): Promise<Map<string, Point>> {
  return runElk(boxes, [], PACKING_OPTIONS);
}

async function runElk(boxes: Box[], links: DirectedLink[], layoutOptions: LayoutOptions): Promise<Map<string, Point>> {
  const boxIds = new Set(boxes.map((box) => box.id));
  const edges: ElkExtendedEdge[] = links
    .filter((link) => boxIds.has(link.from) && boxIds.has(link.to) && link.from !== link.to)
    .map((link, index) => ({ id: `e${index}`, sources: [link.from], targets: [link.to] }));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions,
    children: boxes.map((box) => ({ id: box.id, width: box.width, height: box.height })),
    edges,
  };
  const result = await elk.layout(graph);
  const positions = new Map<string, Point>();
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}

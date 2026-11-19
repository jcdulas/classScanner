// Draws the relations between cards (spec §3, §4.5).
//
// Drawing thousands of edges one object at a time would be slow, so each
// relation kind is drawn as one batch: a single Graphics object whose path
// contains every line of that kind, stroked once, then every decoration,
// filled once. Toggling a relation kind only shows or hides its batch.
//
// Line widths are given in screen pixels and converted to world units with
// the current zoom, so the batches are rebuilt when the zoom changes a lot
// (see DiagramRenderer).

import { BitmapText, Container, Graphics } from 'pixi.js';
import { ALL_RELATION_KINDS, RelationKind } from '../../shared/graphModel';
import { Point } from '../../shared/savedState';
import { Rect, rectCenter } from '../model/geometry';
import {
  DASH_PATTERNS,
  EDGE_STYLES,
  LineStyle,
  Segment,
  aggregatedLinkWidth,
  clipSegmentToRect,
  decorationPolygon,
  decorationSizeForScale,
  dashSegments,
  edgeSegment,
  lineEndBeforeDecoration,
} from '../model/edgeGeometry';
import { AggregatedLink, DisplayedEdges, IndividualEdge } from '../model/sceneGeometry';
import { CARD_FONTS } from './fonts';
import { Theme } from './theme';

const DIMMED_ALPHA = 0.12;
const MAX_FRIEND_LABELS = 200;
const AGGREGATED_ALPHA = 0.35;
/** The edges of the selected classes are drawn this much thicker. */
const HIGHLIGHT_WIDTH_FACTOR = 1.6;
const MAX_DASHES_PER_BATCH = 20_000;

export class EdgeLayer {
  readonly container = new Container();
  private readonly batches = new Map<RelationKind, Graphics>();
  private readonly aggregatedGraphics = new Graphics();
  private readonly highlightGraphics = new Graphics();
  private readonly labels = new Container();
  private readonly baseContainer = new Container();
  private isFriendKindActive = false;
  private areLabelsReadable = false;

  constructor() {
    for (const kind of ALL_RELATION_KINDS) {
      const graphics = new Graphics();
      this.batches.set(kind, graphics);
      this.baseContainer.addChild(graphics);
    }
    this.baseContainer.addChild(this.aggregatedGraphics, this.labels);
    this.container.addChild(this.baseContainer, this.highlightGraphics);
  }

  /**
   * Redraws the batches of the given relation kinds only; the other batches are kept as they are.
   * `visibleArea` limits the dashes of dashed lines to the part of the diagram that can be seen.
   */
  rebuildBatches(
    kinds: Iterable<RelationKind>,
    displayed: DisplayedEdges,
    theme: Theme,
    scale: number,
    visibleArea: Rect | undefined,
  ): void {
    const byKind = groupByKind(displayed.individual);
    for (const kind of kinds) {
      const graphics = this.batches.get(kind)!;
      graphics.clear();
      drawEdgeBatch(graphics, byKind.get(kind) ?? [], kind, theme.relationColors[kind], theme, scale, 1, visibleArea);
      if (kind === 'friend') {
        this.drawFriendLabels(byKind.get('friend') ?? [], theme);
      }
    }
  }

  /** Shows the batches of the active relation kinds and hides the others: toggling a kind costs nothing. */
  showOnly(activeKinds: Set<RelationKind>): void {
    for (const [kind, graphics] of this.batches) {
      graphics.visible = activeKinds.has(kind);
    }
    this.isFriendKindActive = activeKinds.has('friend');
    this.labels.visible = this.isFriendKindActive && this.areLabelsReadable;
  }

  /** The friend labels are only shown when the view is close enough to read them. */
  setLabelsReadable(areReadable: boolean): void {
    this.areLabelsReadable = areReadable;
    this.labels.visible = this.isFriendKindActive && areReadable;
  }

  /** Merged links between groups depend on every active kind, so they are redrawn on each change. */
  rebuildAggregated(displayed: DisplayedEdges, theme: Theme, scale: number): void {
    this.drawAggregated(displayed.aggregated, theme, scale);
  }

  /** Draws the edges of the selected classes on top of the others, in the accent color. */
  rebuildHighlight(edges: IndividualEdge[], theme: Theme, scale: number): void {
    this.highlightGraphics.clear();
    for (const [kind, items] of groupByKind(edges)) {
      drawEdgeBatch(this.highlightGraphics, items, kind, theme.accent, theme, scale, HIGHLIGHT_WIDTH_FACTOR, undefined);
    }
  }

  /** While classes are selected, the other edges are faded (spec §4.5). */
  setDimmed(isDimmed: boolean): void {
    this.baseContainer.alpha = isDimmed ? DIMMED_ALPHA : 1;
  }

  setVisible(isVisible: boolean): void {
    this.container.visible = isVisible;
  }

  private drawAggregated(links: AggregatedLink[], theme: Theme, scale: number): void {
    const graphics = this.aggregatedGraphics;
    graphics.clear();
    for (const link of links) {
      const { start, end } = edgeSegment(link.source, link.target);
      const widthInPixels = aggregatedLinkWidth(link.total);
      graphics.moveTo(start.x, start.y).lineTo(end.x, end.y);
      graphics.stroke({ width: widthInPixels / scale, color: theme.mutedText, alpha: AGGREGATED_ALPHA, cap: 'round' });
    }
  }

  private drawFriendLabels(friendEdges: IndividualEdge[], theme: Theme): void {
    this.labels.removeChildren().forEach((child) => child.destroy());
    for (const item of friendEdges.slice(0, MAX_FRIEND_LABELS)) {
      const middle = midpoint(rectCenter(item.source), rectCenter(item.target));
      const label = new BitmapText({ text: '«friend»', style: { fontFamily: CARD_FONTS.italic, fontSize: 11 } });
      label.tint = theme.relationColors.friend;
      label.position.set(middle.x + 4, middle.y - 14);
      this.labels.addChild(label);
    }
  }
}

/**
 * Draws edges of one kind into `graphics`: first all the lines in one path, stroked once,
 * then all the decorations.
 */
function drawEdgeBatch(
  graphics: Graphics,
  edges: IndividualEdge[],
  kind: RelationKind,
  color: number,
  theme: Theme,
  scale: number,
  widthFactor: number,
  visibleArea: Rect | undefined,
): void {
  if (edges.length === 0) {
    return;
  }
  const style = EDGE_STYLES[kind];
  const lineWidth = (style.width * widthFactor) / scale;
  const decorationSize = decorationSizeForScale(scale);
  const closedDecorations: number[][] = [];
  const circles: Point[] = [];

  const shapes = edges.map((item) => {
    const segment = edgeSegment(item.source, item.target);
    // The decoration sits at the `from` end for composition, aggregation and nesting.
    const tip = style.decorationAtSource ? segment.start : segment.end;
    const tail = style.decorationAtSource ? segment.end : segment.start;
    const line = { start: tail, end: lineEndBeforeDecoration(style.decoration, tail, tip, decorationSize) };
    return { line, polygon: decorationPolygon(style.decoration, tail, tip, decorationSize) };
  });
  const dashPattern = chooseDashPattern(style.line, shapes.map((shape) => shape.line), scale, visibleArea);

  for (const { line, polygon } of shapes) {
    if (dashPattern === undefined) {
      graphics.moveTo(line.start.x, line.start.y).lineTo(line.end.x, line.end.y);
    } else {
      const visiblePart = visibleArea === undefined ? line : clipSegmentToRect(line, visibleArea);
      if (visiblePart !== undefined) {
        for (const dash of dashSegments(visiblePart, dashPattern[0] / scale, dashPattern[1] / scale)) {
          graphics.moveTo(dash.start.x, dash.start.y).lineTo(dash.end.x, dash.end.y);
        }
      }
    }
    if (style.decoration === 'openArrow') {
      // An open arrow is two short lines: it joins the same path as the edge lines.
      graphics.moveTo(polygon[0], polygon[1]).lineTo(polygon[2], polygon[3]).lineTo(polygon[4], polygon[5]);
    } else if (style.decoration === 'circledPlus') {
      circles.push({ x: polygon[0], y: polygon[1] });
    } else {
      closedDecorations.push(polygon);
    }
  }
  const alpha = lineAlphaForCount(edges.length);
  graphics.stroke({ width: lineWidth, color, alpha });

  if (closedDecorations.length > 0) {
    const fillColor = style.decoration === 'filledDiamond' ? color : theme.background;
    for (const polygon of closedDecorations) {
      graphics.poly(polygon, true);
    }
    graphics.fill(fillColor);
    for (const polygon of closedDecorations) {
      graphics.poly(polygon, true);
    }
    graphics.stroke({ width: lineWidth, color, alpha });
  }
  if (circles.length > 0) {
    const radius = decorationSize * 0.6;
    for (const center of circles) {
      graphics.circle(center.x, center.y, radius);
    }
    graphics.fill(theme.background);
    for (const center of circles) {
      graphics.circle(center.x, center.y, radius);
      graphics.moveTo(center.x - radius, center.y).lineTo(center.x + radius, center.y);
      graphics.moveTo(center.x, center.y - radius).lineTo(center.x, center.y + radius);
    }
    graphics.stroke({ width: lineWidth, color, alpha });
  }
}

/**
 * Dashes are drawn one by one, which is costly: a batch that would need more than
 * MAX_DASHES_PER_BATCH dashes is drawn with solid lines instead. With that many edges on
 * screen the dash patterns are not readable anyway (spec §8: toggling a kind under 100 ms).
 */
function chooseDashPattern(
  lineStyle: LineStyle,
  lines: Segment[],
  scale: number,
  visibleArea: Rect | undefined,
): [number, number] | undefined {
  const pattern = DASH_PATTERNS[lineStyle];
  if (pattern === undefined) {
    return undefined;
  }
  const periodInWorld = (pattern[0] + pattern[1]) / scale;
  let dashCount = 0;
  for (const line of lines) {
    const visiblePart = visibleArea === undefined ? line : clipSegmentToRect(line, visibleArea);
    if (visiblePart !== undefined) {
      dashCount += Math.hypot(visiblePart.end.x - visiblePart.start.x, visiblePart.end.y - visiblePart.start.y) / periodInWorld;
    }
    if (dashCount > MAX_DASHES_PER_BATCH) {
      return undefined;
    }
  }
  return pattern;
}

/**
 * Opacity of the lines of a batch. A few hundred edges are drawn almost opaque. Thousands of
 * edges, as when the whole diagram is in view, are drawn more and more transparent: they
 * stay visible as a veil without hiding the cards behind a solid mass of lines.
 */
function lineAlphaForCount(edgeCount: number): number {
  const fullOpacityCount = 400;
  if (edgeCount <= fullOpacityCount) {
    return 0.9;
  }
  return Math.max(0.3, 0.9 * Math.sqrt(fullOpacityCount / edgeCount));
}

function groupByKind(edges: IndividualEdge[]): Map<RelationKind, IndividualEdge[]> {
  const byKind = new Map<RelationKind, IndividualEdge[]>();
  for (const item of edges) {
    const list = byKind.get(item.edge.kind) ?? [];
    list.push(item);
    byKind.set(item.edge.kind, list);
  }
  return byKind;
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

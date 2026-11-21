// Draws the relations between cards (spec §3, §4.5).
//
// Drawing thousands of edges one object at a time would be slow, so each
// relation kind is drawn as one batch: a single Graphics object whose path
// contains every line of that kind, stroked once, then every decoration,
// filled once. Toggling a relation kind only shows or hides its batch.
//
// The path of each edge comes from src/webview/model/edgeRouting.ts. Line
// widths are given in screen pixels and converted to world units with the
// current zoom, so the batches are rebuilt when the zoom changes a lot (see
// DiagramRenderer).
//
// The paths are kept: they tell which edge is under the pointer, and the edge
// under the pointer is drawn again on top, in the accent color.

import { BitmapText, Container, Graphics } from 'pixi.js';
import { ALL_RELATION_KINDS, RelationKind } from '../../shared/graphModel';
import { Point } from '../../shared/savedState';
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
import { nearestRouteWithin } from '../model/edgeHitTest';
import { RoutedEdge, RoutingStyle, routeEdges } from '../model/edgeRouting';
import { Rect } from '../model/geometry';
import { AggregatedLink, DisplayedEdges, IndividualEdge } from '../model/sceneGeometry';
import { CARD_FONTS } from './fonts';
import { Theme } from './theme';

const DIMMED_ALPHA = 0.12;
const MAX_FRIEND_LABELS = 200;
const AGGREGATED_ALPHA = 0.35;
/** The edges of the selected classes are drawn this much thicker. */
const HIGHLIGHT_WIDTH_FACTOR = 1.6;
const MAX_DASHES_PER_BATCH = 20_000;
/** Radius of the rounded corners of orthogonal edges, in diagram units. */
const CORNER_RADIUS = 7;
/**
 * A rounded corner is drawn with about ten small segments. Batches with more edges than this
 * get square corners, which cannot be told apart when that many edges are on screen.
 */
const MAX_ROUNDED_EDGES = 2000;

export class EdgeLayer {
  readonly container = new Container();
  private readonly batches = new Map<RelationKind, Graphics>();
  /** The paths drawn in each batch, kept to draw the highlighted edges exactly over them. */
  private readonly routesByKind = new Map<RelationKind, RoutedEdge[]>();
  private readonly aggregatedGraphics = new Graphics();
  private readonly highlightGraphics = new Graphics();
  private readonly hoverGraphics = new Graphics();
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
    this.container.addChild(this.baseContainer, this.highlightGraphics, this.hoverGraphics);
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
    routingStyle: RoutingStyle,
  ): void {
    const byKind = groupByKind(displayed.individual);
    for (const kind of kinds) {
      const routes = routeEdges(byKind.get(kind) ?? [], kind, routingStyle);
      this.routesByKind.set(kind, routes);
      const graphics = this.batches.get(kind)!;
      graphics.clear();
      drawEdgeBatch(graphics, routes, kind, theme.relationColors[kind], theme, scale, 1, visibleArea);
      if (kind === 'friend') {
        this.drawFriendLabels(routes, theme);
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
  rebuildHighlight(selection: Set<string>, activeKinds: Set<RelationKind>, theme: Theme, scale: number): void {
    this.highlightGraphics.clear();
    if (selection.size === 0) {
      return;
    }
    for (const kind of activeKinds) {
      const routes = (this.routesByKind.get(kind) ?? []).filter((route) => selection.has(route.edge.from) || selection.has(route.edge.to));
      drawEdgeBatch(this.highlightGraphics, routes, kind, theme.accent, theme, scale, HIGHLIGHT_WIDTH_FACTOR, undefined);
    }
  }

  /**
   * The edge drawn under a point, within `tolerance` diagram units. While classes are selected,
   * their edges, which are drawn over the others, are looked at first.
   */
  routeAt(point: Point, tolerance: number, activeKinds: Set<RelationKind>, selection: Set<string>): RoutedEdge | undefined {
    if (!this.container.visible) {
      return undefined;
    }
    let nearestOfSelection: { route: RoutedEdge; distance: number } | undefined;
    let nearest: { route: RoutedEdge; distance: number } | undefined;
    for (const kind of activeKinds) {
      const routes = this.routesByKind.get(kind) ?? [];
      const found = nearestRouteWithin(routes, point, tolerance);
      if (found !== undefined && (nearest === undefined || found.distance < nearest.distance)) {
        nearest = found;
      }
      if (selection.size > 0) {
        const routesOfSelection = routes.filter((route) => selection.has(route.edge.from) || selection.has(route.edge.to));
        const foundInSelection = nearestRouteWithin(routesOfSelection, point, tolerance);
        if (foundInSelection !== undefined && (nearestOfSelection === undefined || foundInSelection.distance < nearestOfSelection.distance)) {
          nearestOfSelection = foundInSelection;
        }
      }
    }
    return (nearestOfSelection ?? nearest)?.route;
  }

  /** Draws the edge under the pointer over the others, in the accent color; `undefined` removes it. */
  setHovered(route: RoutedEdge | undefined, theme: Theme, scale: number): void {
    this.hoverGraphics.clear();
    if (route !== undefined) {
      drawEdgeBatch(this.hoverGraphics, [route], route.edge.kind, theme.accent, theme, scale, HIGHLIGHT_WIDTH_FACTOR, undefined);
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

  private drawFriendLabels(friendRoutes: RoutedEdge[], theme: Theme): void {
    this.labels.removeChildren().forEach((child) => child.destroy());
    for (const route of friendRoutes.slice(0, MAX_FRIEND_LABELS)) {
      const middle = middleOfPath(route.points);
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
  routes: RoutedEdge[],
  kind: RelationKind,
  color: number,
  theme: Theme,
  scale: number,
  widthFactor: number,
  visibleArea: Rect | undefined,
): void {
  if (routes.length === 0) {
    return;
  }
  const style = EDGE_STYLES[kind];
  const lineWidth = (style.width * widthFactor) / scale;
  const decorationSize = decorationSizeForScale(scale);
  const closedDecorations: number[][] = [];
  const circles: Point[] = [];

  const shapes = routes.map((route) => {
    // The decoration sits at the `from` end for composition, aggregation and nesting.
    const points = route.points;
    const tipIndex = style.decorationAtSource ? 0 : points.length - 1;
    const tailIndex = style.decorationAtSource ? 1 : points.length - 2;
    const linePoints = [...points];
    // The line stops where a closed decoration starts, so that it does not cross it.
    linePoints[tipIndex] = lineEndBeforeDecoration(style.decoration, points[tailIndex], points[tipIndex], decorationSize);
    return { linePoints, polygon: decorationPolygon(style.decoration, points[tailIndex], points[tipIndex], decorationSize) };
  });
  const dashPattern = chooseDashPattern(style.line, shapes, scale, visibleArea);
  const cornerRadius = routes.length <= MAX_ROUNDED_EDGES ? CORNER_RADIUS : 0;

  for (const { linePoints, polygon } of shapes) {
    if (dashPattern === undefined) {
      drawPolyline(graphics, linePoints, cornerRadius);
    } else {
      for (const leg of legsOf(linePoints)) {
        const visiblePart = visibleArea === undefined ? leg : clipSegmentToRect(leg, visibleArea);
        if (visiblePart !== undefined) {
          for (const dash of dashSegments(visiblePart, dashPattern[0] / scale, dashPattern[1] / scale)) {
            graphics.moveTo(dash.start.x, dash.start.y).lineTo(dash.end.x, dash.end.y);
          }
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
  const alpha = lineAlphaForCount(routes.length);
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

/** Adds a path through `points` to the current path, with corners rounded by `cornerRadius`. */
function drawPolyline(graphics: Graphics, points: Point[], cornerRadius: number): void {
  graphics.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index++) {
    const corner = points[index];
    const radius = Math.min(cornerRadius, distance(points[index - 1], corner) / 2, distance(corner, points[index + 1]) / 2);
    if (radius < 1) {
      graphics.lineTo(corner.x, corner.y);
      continue;
    }
    // The line stops `radius` before the corner, and a curve joins it to the next segment.
    const before = pointToward(corner, points[index - 1], radius);
    const after = pointToward(corner, points[index + 1], radius);
    graphics.lineTo(before.x, before.y).quadraticCurveTo(corner.x, corner.y, after.x, after.y);
  }
  const last = points[points.length - 1];
  graphics.lineTo(last.x, last.y);
}

/** The straight segments of a path. */
function legsOf(points: Point[]): Segment[] {
  const legs: Segment[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    legs.push({ start: points[index], end: points[index + 1] });
  }
  return legs;
}

/**
 * Dashes are drawn one by one, which is costly: a batch that would need more than
 * MAX_DASHES_PER_BATCH dashes is drawn with solid lines instead. With that many edges on
 * screen the dash patterns are not readable anyway (spec §8: toggling a kind under 100 ms).
 */
function chooseDashPattern(
  lineStyle: LineStyle,
  shapes: { linePoints: Point[] }[],
  scale: number,
  visibleArea: Rect | undefined,
): [number, number] | undefined {
  const pattern = DASH_PATTERNS[lineStyle];
  if (pattern === undefined) {
    return undefined;
  }
  const periodInWorld = (pattern[0] + pattern[1]) / scale;
  let dashCount = 0;
  for (const shape of shapes) {
    for (const leg of legsOf(shape.linePoints)) {
      const visiblePart = visibleArea === undefined ? leg : clipSegmentToRect(leg, visibleArea);
      if (visiblePart !== undefined) {
        dashCount += distance(visiblePart.start, visiblePart.end) / periodInWorld;
      }
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

/** The point halfway along a path, measured along its segments. */
function middleOfPath(points: Point[]): Point {
  const legs = legsOf(points);
  const halfLength = legs.reduce((total, leg) => total + distance(leg.start, leg.end), 0) / 2;
  let walked = 0;
  for (const leg of legs) {
    const length = distance(leg.start, leg.end);
    if (walked + length >= halfLength && length > 0) {
      return pointToward(leg.start, leg.end, halfLength - walked);
    }
    walked += length;
  }
  return points[0];
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** The point at `length` from `from`, in the direction of `to`. */
function pointToward(from: Point, to: Point, length: number): Point {
  const total = distance(from, to) || 1;
  return { x: from.x + ((to.x - from.x) * length) / total, y: from.y + ((to.y - from.y) * length) / total };
}

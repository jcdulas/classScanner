// Builds an SVG image of the diagram from the model (spec §4.7).
//
// The SVG is generated from the same data as the WebGL rendering (card
// geometry, group boxes, displayed edges), not captured from the screen, so
// its text stays selectable and sharp at any size. Cards are drawn with full
// detail, honoring their display mode.

import { RelationKind, Visibility } from '../../shared/graphModel';
import { CARD_STYLE, CardLayout } from '../model/cardGeometry';
import {
  DASH_PATTERNS,
  EDGE_STYLES,
  aggregatedLinkWidth,
  decorationPolygon,
  decorationSizeForScale,
  edgeSegment,
  lineEndBeforeDecoration,
} from '../model/edgeGeometry';
import { Rect, expandRect, unionOfRects } from '../model/geometry';
import { GROUP_STYLE } from '../model/groups';
import { GroupBox, cardRect, computeDisplayedEdges, computeGroupBoxes, isCardShown } from '../model/sceneGeometry';
import { cardContentFor } from '../render/levelOfDetail';
import { Theme, contrastingTextColor, groupColor, toCssColor } from '../render/theme';
import { DiagramStore } from '../state/diagramStore';

/** The SVG is drawn at a zoom of 1: one diagram unit is one pixel. */
const DECORATION_SIZE = decorationSizeForScale(1);
const FONT_FAMILY = 'Consolas, Menlo, "Courier New", monospace';

export function buildSvg(store: DiagramStore, theme: Theme, scope: 'diagram' | 'selection'): string {
  const allGroupBoxes = computeGroupBoxes(store);
  const shownIds = Array.from(store.visibleNodeIds).filter((id) => isCardShown(store, allGroupBoxes, id));
  const ids = scope === 'selection' ? shownIds.filter((id) => store.selection.has(id)) : shownIds;
  if (ids.length === 0) {
    throw new Error(scope === 'selection' ? 'No class is selected.' : 'The diagram is empty.');
  }
  const idSet = new Set(ids);
  // The selection export only contains cards and the edges between them.
  const groupBoxes = scope === 'diagram' ? allGroupBoxes : new Map<string, GroupBox>();
  const displayed = computeDisplayedEdges(store, groupBoxes);
  const edges = scope === 'diagram' ? displayed.individual : displayed.individual.filter((item) => idSet.has(item.edge.from) && idSet.has(item.edge.to));

  const rects: Rect[] = ids.flatMap((id) => cardRect(store, id) ?? []);
  for (const box of groupBoxes.values()) {
    rects.push(box.isCollapsed ? box.collapsedRect : box.rect);
  }
  const bounds = expandRect(unionOfRects(rects)!, 40);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" ` +
      `viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" font-family='${FONT_FAMILY}'>`,
    `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${toCssColor(theme.background)}"/>`,
  );
  for (const box of groupBoxes.values()) {
    parts.push(groupSvg(box, theme));
  }
  for (const item of edges) {
    parts.push(edgeSvg(item.source, item.target, item.edge.kind, theme));
  }
  for (const link of displayed.aggregated) {
    if (scope === 'diagram') {
      const { start, end } = edgeSegment(link.source, link.target);
      parts.push(
        `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${toCssColor(theme.mutedText)}" ` +
          `stroke-opacity="0.35" stroke-width="${aggregatedLinkWidth(link.total)}" stroke-linecap="round"/>`,
      );
    }
  }
  for (const id of ids) {
    const rect = cardRect(store, id)!;
    const layout = store.cardLayouts.get(id)!;
    const node = store.nodeById.get(id)!;
    const content = cardContentFor('full', store.displayModeOf(id));
    const color = groupColor(theme, store.groupKeyByNode.get(id) ?? '');
    parts.push(cardSvg(rect, layout, color, theme, content === 'members', node.isAbstract));
  }
  parts.push('</svg>');
  return parts.join('\n');
}

function groupSvg(box: GroupBox, theme: Theme): string {
  const color = toCssColor(groupColor(theme, box.key));
  const rect = box.isCollapsed ? box.collapsedRect : box.rect;
  const fill = box.isCollapsed ? color : toCssColor(theme.groupFill);
  const fillOpacity = box.isCollapsed ? 1 : 0.6;
  const titleColor = box.isCollapsed ? toCssColor(contrastingTextColor(groupColor(theme, box.key))) : toCssColor(theme.groupTitle);
  const lines = [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="10" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="1.5"/>`,
    `<text x="${rect.x + 10}" y="${rect.y + GROUP_STYLE.titleHeight / 2 + 5}" font-size="15" font-weight="bold" fill="${titleColor}">${escapeXml(box.label)}</text>`,
  ];
  if (box.isCollapsed) {
    lines.push(`<text x="${rect.x + 10}" y="${rect.y + rect.height - 10}" font-size="13" fill="${titleColor}">${box.memberIds.length} classes</text>`);
  }
  return lines.join('\n');
}

function edgeSvg(source: Rect, target: Rect, kind: RelationKind, theme: Theme): string {
  const style = EDGE_STYLES[kind];
  const color = toCssColor(theme.relationColors[kind]);
  const segment = edgeSegment(source, target);
  const tip = style.decorationAtSource ? segment.start : segment.end;
  const tail = style.decorationAtSource ? segment.end : segment.start;
  const lineEnd = lineEndBeforeDecoration(style.decoration, tail, tip, DECORATION_SIZE);
  const dash = DASH_PATTERNS[style.line];
  const dashAttribute = dash === undefined ? '' : ` stroke-dasharray="${dash[0]} ${dash[1]}"`;
  const polygon = decorationPolygon(style.decoration, tail, tip, DECORATION_SIZE);
  const parts = [
    `<line x1="${tail.x}" y1="${tail.y}" x2="${lineEnd.x}" y2="${lineEnd.y}" stroke="${color}" stroke-width="${style.width}"${dashAttribute}/>`,
  ];
  const points = pointsAttribute(polygon);
  switch (style.decoration) {
    case 'openArrow':
      parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${style.width}"/>`);
      break;
    case 'circledPlus': {
      const [centerX, centerY] = polygon;
      const radius = DECORATION_SIZE * 0.6;
      parts.push(
        `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${toCssColor(theme.background)}" stroke="${color}" stroke-width="${style.width}"/>`,
        `<path d="M${centerX - radius} ${centerY}H${centerX + radius}M${centerX} ${centerY - radius}V${centerY + radius}" stroke="${color}" stroke-width="${style.width}"/>`,
      );
      break;
    }
    default: {
      const fill = style.decoration === 'filledDiamond' ? color : toCssColor(theme.background);
      parts.push(`<polygon points="${points}" fill="${fill}" stroke="${color}" stroke-width="${style.width}"/>`);
    }
  }
  return parts.join('\n');
}

function cardSvg(rect: Rect, layout: CardLayout, headerColor: number, theme: Theme, showMembers: boolean, isAbstract: boolean): string {
  const { x, y, width, height } = rect;
  const radius = CARD_STYLE.cornerRadius;
  const headerHeight = Math.min(height, CARD_STYLE.headerHeight);
  const header = toCssColor(headerColor);
  const headerText = toCssColor(contrastingTextColor(headerColor));
  const border = toCssColor(theme.cardBorder);
  const parts = [
    `<g transform="translate(${x} ${y})">`,
    `<rect width="${width}" height="${height}" rx="${radius}" fill="${toCssColor(theme.cardFill)}"/>`,
    // The header band: rounded at the top, square at the bottom.
    `<path d="M0 ${headerHeight}V${radius}Q0 0 ${radius} 0H${width - radius}Q${width} 0 ${width} ${radius}V${headerHeight}Z" fill="${header}"/>`,
  ];
  if (layout.badge !== '') {
    parts.push(`<text x="${CARD_STYLE.paddingX}" y="15" font-size="${CARD_STYLE.badgeFontSize}" fill="${headerText}" fill-opacity="0.8">${escapeXml(layout.badge)}</text>`);
  }
  const titleY = layout.badge === '' ? headerHeight / 2 + 5 : 33;
  const titleStyle = isAbstract ? 'font-style="italic"' : 'font-weight="bold"';
  parts.push(`<text x="${CARD_STYLE.paddingX}" y="${titleY}" font-size="${CARD_STYLE.titleFontSize}" ${titleStyle} fill="${headerText}">${escapeXml(layout.title)}</text>`);

  if (showMembers) {
    for (const separatorY of layout.separatorYs) {
      if (separatorY > CARD_STYLE.headerHeight) {
        parts.push(`<line x1="0" y1="${separatorY}" x2="${width}" y2="${separatorY}" stroke="${border}"/>`);
      }
    }
    const textX = CARD_STYLE.paddingX + CARD_STYLE.iconColumnWidth;
    for (const row of layout.rows) {
      const baseline = row.y + CARD_STYLE.rowHeight / 2 + 4;
      if (row.visibility !== undefined) {
        parts.push(visibilityIconSvg(row.visibility, CARD_STYLE.paddingX + 4, row.y + CARD_STYLE.rowHeight / 2, theme));
      }
      const isMuted = row.kind === 'more' || row.kind === 'specialization';
      const attributes = [
        `x="${textX}"`,
        `y="${baseline}"`,
        `font-size="${CARD_STYLE.memberFontSize}"`,
        `fill="${toCssColor(isMuted ? theme.mutedText : theme.text)}"`,
        row.isItalic ? 'font-style="italic"' : '',
        row.isStatic ? 'text-decoration="underline"' : '',
      ];
      parts.push(`<text ${attributes.filter((attribute) => attribute !== '').join(' ')}>${escapeXml(row.text)}</text>`);
    }
  }
  parts.push(`<rect width="${width}" height="${height}" rx="${radius}" fill="none" stroke="${border}"/>`, '</g>');
  return parts.join('\n');
}

function visibilityIconSvg(visibility: Visibility, x: number, y: number, theme: Theme): string {
  const color = toCssColor(theme.visibilityColors[visibility]);
  const size = 3.5;
  if (visibility === 'public') {
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}"/>`;
  }
  if (visibility === 'protected') {
    return `<polygon points="${x},${y - size - 0.5} ${x + size + 0.5},${y} ${x},${y + size + 0.5} ${x - size - 0.5},${y}" fill="${color}"/>`;
  }
  return `<rect x="${x - size}" y="${y - size}" width="${size * 2}" height="${size * 2}" fill="${color}"/>`;
}

function pointsAttribute(flatPoints: number[]): string {
  const pairs: string[] = [];
  for (let index = 0; index + 1 < flatPoints.length; index += 2) {
    pairs.push(`${flatPoints[index]},${flatPoints[index + 1]}`);
  }
  return pairs.join(' ');
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

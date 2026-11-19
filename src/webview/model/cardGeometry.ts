// Computes the size of a class card and the position of every line on it (spec §4.3).
//
// The same computation is used by the layout (to know how much room each card
// needs), by the renderer (to draw the card), by hit-testing (to know which
// member was clicked) and by the SVG export. Text is drawn with a monospace
// font, so the width of a line is simply its number of characters multiplied
// by the width of one character.

import { ClassNode, Member, MemberFlags, Visibility } from '../../shared/graphModel';
import { DisplayMode } from '../../shared/savedState';

/** Measured once by the renderer from the actual font; a fixed estimate is used in tests. */
export interface FontMetrics {
  /** Width of one character at CARD_STYLE.memberFontSize. */
  charWidth: number;
}

export const CARD_STYLE = {
  memberFontSize: 12,
  titleFontSize: 14,
  badgeFontSize: 10,
  headerHeight: 42,
  rowHeight: 18,
  sectionGap: 6,
  paddingX: 10,
  paddingBottom: 6,
  /** Room for the visibility icon at the start of each member line. */
  iconColumnWidth: 14,
  minWidth: 150,
  maxLineCharacters: 60,
  cornerRadius: 6,
};

/**
 * How much room a card takes in the layout:
 *   - `header`: title only (pinned compact);
 *   - `capped`: full view limited to `maxMembersInAutoMode` lines (auto mode);
 *   - `all`: every member (pinned full).
 */
export type CardFootprint = 'header' | 'capped' | 'all';

export type CardRowKind = 'attribute' | 'method' | 'enumValue' | 'specialization' | 'more';

export interface CardRow {
  kind: CardRowKind;
  text: string;
  /** Top of the row, relative to the top of the card. */
  y: number;
  member?: Member;
  visibility?: Visibility;
  /** Virtual methods are drawn in italics (UML convention). */
  isItalic: boolean;
  /** Static members are underlined (UML convention). */
  isStatic: boolean;
}

export interface CardLayout {
  width: number;
  height: number;
  title: string;
  /** Stereotype text such as `«struct»` or `«abstract»`, or an empty string. */
  badge: string;
  rows: CardRow[];
  /** Vertical positions of the lines drawn between sections (attributes, methods...). */
  separatorYs: number[];
}

export function footprintForDisplayMode(displayMode: DisplayMode): CardFootprint {
  switch (displayMode) {
    case 'compact':
      return 'header';
    case 'full':
      return 'all';
    default:
      return 'capped';
  }
}

export function computeCardLayout(
  node: ClassNode,
  footprint: CardFootprint,
  maxMembersInAutoMode: number,
  metrics: FontMetrics,
): CardLayout {
  const title = cardTitle(node);
  const badge = cardBadge(node);
  const sections = footprint === 'header' ? [] : buildSections(node);
  const maxRows = footprint === 'capped' ? maxMembersInAutoMode : Infinity;

  const rows: CardRow[] = [];
  const separatorYs: number[] = [];
  let y = CARD_STYLE.headerHeight;
  let shownRowCount = 0;
  const totalRowCount = sections.reduce((total, section) => total + section.length, 0);

  for (const section of sections) {
    if (shownRowCount >= maxRows) {
      break;
    }
    separatorYs.push(y);
    y += CARD_STYLE.sectionGap / 2;
    for (const row of section) {
      if (shownRowCount >= maxRows) {
        break;
      }
      rows.push({ ...row, y });
      y += CARD_STYLE.rowHeight;
      shownRowCount++;
    }
    y += CARD_STYLE.sectionGap / 2;
  }
  if (shownRowCount < totalRowCount) {
    rows.push({ kind: 'more', text: `+ ${totalRowCount - shownRowCount} more`, y, isItalic: true, isStatic: false });
    y += CARD_STYLE.rowHeight;
  }
  const height = rows.length === 0 ? CARD_STYLE.headerHeight : y + CARD_STYLE.paddingBottom;
  return { width: cardWidth(title, badge, rows, metrics), height, title, badge, rows, separatorYs };
}

/** `Buffer<T, N>` for a template, otherwise the short name. */
export function cardTitle(node: ClassNode): string {
  const parameters = node.templateParams ?? [];
  return parameters.length > 0 ? `${node.name}<${parameters.join(', ')}>` : node.name;
}

function cardBadge(node: ClassNode): string {
  const words: string[] = [];
  if (node.isExternal) words.push('external');
  if (node.isAbstract) words.push('abstract');
  if (node.kind !== 'class') words.push(node.kind);
  if (node.templateParams !== undefined && node.templateParams.length > 0) words.push('template');
  return words.length === 0 ? '' : `«${words.join(' ')}»`;
}

type RowWithoutPosition = Omit<CardRow, 'y'>;

function buildSections(node: ClassNode): RowWithoutPosition[][] {
  const sections: RowWithoutPosition[][] = [];
  if (node.enumValues !== undefined && node.enumValues.length > 0) {
    sections.push(node.enumValues.map((value) => ({ kind: 'enumValue', text: truncate(value), isItalic: false, isStatic: false })));
  }
  if (node.attributes.length > 0) {
    sections.push(node.attributes.map((member) => memberRow('attribute', member, `${member.name}: ${member.signature}`)));
  }
  if (node.methods.length > 0) {
    sections.push(node.methods.map((member) => memberRow('method', member, `${member.name}${member.signature}`)));
  }
  if (node.specializations !== undefined && node.specializations.length > 0) {
    sections.push(
      node.specializations.map((name) => ({ kind: 'specialization', text: truncate(name), isItalic: false, isStatic: false })),
    );
  }
  return sections;
}

function memberRow(kind: 'attribute' | 'method', member: Member, text: string): RowWithoutPosition {
  return {
    kind,
    text: truncate(text),
    member,
    visibility: member.visibility,
    isItalic: (member.flags & MemberFlags.Virtual) !== 0,
    isStatic: (member.flags & MemberFlags.Static) !== 0,
  };
}

function cardWidth(title: string, badge: string, rows: CardRow[], metrics: FontMetrics): number {
  const titleCharWidth = metrics.charWidth * (CARD_STYLE.titleFontSize / CARD_STYLE.memberFontSize);
  const badgeCharWidth = metrics.charWidth * (CARD_STYLE.badgeFontSize / CARD_STYLE.memberFontSize);
  let contentWidth = Math.max(
    Math.min(title.length, CARD_STYLE.maxLineCharacters) * titleCharWidth,
    badge.length * badgeCharWidth,
  );
  for (const row of rows) {
    contentWidth = Math.max(contentWidth, CARD_STYLE.iconColumnWidth + row.text.length * metrics.charWidth);
  }
  // A 5% margin, so that text never touches the border when the editor font is not exactly monospace.
  return Math.ceil(Math.max(CARD_STYLE.minWidth, contentWidth * 1.05 + CARD_STYLE.paddingX * 2));
}

export function truncate(text: string, maxCharacters = CARD_STYLE.maxLineCharacters): string {
  return text.length <= maxCharacters ? text : `${text.slice(0, maxCharacters - 1)}…`;
}

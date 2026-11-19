// Colors of the diagram, taken from the active VS Code theme (spec §4.2).
//
// VS Code exposes its theme colors to webviews as CSS variables such as
// `--vscode-editor-background`, and sets a class on <body> (`vscode-light`,
// `vscode-dark`, `vscode-high-contrast`). PixiJS needs colors as numbers
// (0xRRGGBB), so the CSS values are converted with a canvas, which accepts
// every CSS color syntax.

import { RelationKind, Visibility } from '../../shared/graphModel';

export interface Theme {
  isDark: boolean;
  background: number;
  text: number;
  mutedText: number;
  cardFill: number;
  cardBorder: number;
  accent: number;
  groupFill: number;
  groupBorder: number;
  groupTitle: number;
  relationColors: Record<RelationKind, number>;
  visibilityColors: Record<Visibility, number>;
  /** Header colors of the cards, one per group (chosen by a hash of the group key). */
  groupPalette: number[];
}

const colorParser = document.createElement('canvas').getContext('2d')!;

export function readTheme(): Theme {
  const style = getComputedStyle(document.body);
  const isDark = !document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast');
  const color = (variable: string, fallback: number) => cssColorToNumber(style.getPropertyValue(variable), fallback);
  const text = color('--vscode-editor-foreground', isDark ? 0xcccccc : 0x333333);
  return {
    isDark,
    background: color('--vscode-editor-background', isDark ? 0x1e1e1e : 0xffffff),
    text,
    mutedText: color('--vscode-descriptionForeground', isDark ? 0x9d9d9d : 0x717171),
    cardFill: color('--vscode-editorWidget-background', isDark ? 0x252526 : 0xf3f3f3),
    cardBorder: color('--vscode-editorWidget-border', isDark ? 0x454545 : 0xc8c8c8),
    accent: color('--vscode-focusBorder', 0x007fd4),
    groupFill: color('--vscode-sideBar-background', isDark ? 0x252526 : 0xf3f3f3),
    groupBorder: color('--vscode-panel-border', isDark ? 0x3c3c3c : 0xd4d4d4),
    groupTitle: color('--vscode-sideBarTitle-foreground', text),
    relationColors: {
      inherit: text,
      compose: color('--vscode-charts-blue', 0x3794ff),
      aggregate: color('--vscode-charts-green', 0x89d185),
      depend: color('--vscode-charts-orange', 0xd18616),
      include: color('--vscode-charts-lines', 0x808080),
      friend: color('--vscode-charts-purple', 0xb180d7),
      nest: color('--vscode-charts-yellow', 0xcca700),
    },
    visibilityColors: {
      public: color('--vscode-charts-green', 0x89d185),
      protected: color('--vscode-charts-yellow', 0xcca700),
      private: color('--vscode-charts-red', 0xf14c4c),
    },
    groupPalette: buildGroupPalette(isDark),
  };
}

/** Calls `onChange` when the user switches the VS Code theme. */
export function watchThemeChanges(onChange: () => void): void {
  new MutationObserver(onChange).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export function groupColor(theme: Theme, groupKey: string): number {
  return theme.groupPalette[hashString(groupKey) % theme.groupPalette.length];
}

/** Black or white, whichever reads better on the given background. */
export function contrastingTextColor(background: number): number {
  const red = (background >> 16) & 0xff;
  const green = (background >> 8) & 0xff;
  const blue = background & 0xff;
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.6 ? 0x1e1e1e : 0xffffff;
}

export function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function cssColorToNumber(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === '') {
    return fallback;
  }
  // The canvas normalizes any valid CSS color to `#rrggbb` (or `rgba(...)` when transparent).
  colorParser.fillStyle = '#000000';
  colorParser.fillStyle = trimmed;
  const normalized = colorParser.fillStyle;
  if (normalized.startsWith('#')) {
    return parseInt(normalized.slice(1), 16);
  }
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(normalized);
  return match === null ? fallback : (Number(match[1]) << 16) | (Number(match[2]) << 8) | Number(match[3]);
}

/** Twelve hues, darker on a light theme and lighter on a dark one, so that headers keep good contrast. */
function buildGroupPalette(isDark: boolean): number[] {
  const palette: number[] = [];
  for (let index = 0; index < 12; index++) {
    const hue = (index * 137.5) % 360; // The "golden angle" spreads hues evenly.
    palette.push(hslToNumber(hue, isDark ? 0.45 : 0.55, isDark ? 0.38 : 0.62));
  }
  return palette;
}

function hslToNumber(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const sector = Math.floor(hue / 60);
  const [red, green, blue] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][sector % 6];
  const toByte = (channel: number) => Math.round((channel + match) * 255);
  return (toByte(red) << 16) | (toByte(green) << 8) | toByte(blue);
}

function hashString(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

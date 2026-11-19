// The diagram arrangement saved in the workspace (spec §6).
//
// The webview owns this state while the diagram is open and sends it to the
// extension host, which writes it to `.classscanner/<name>.json`. When the
// diagram is opened again, the host sends it back with the new graph.

import { RelationKind } from './graphModel';

export type LayoutKind = 'grouped' | 'hierarchy' | 'organic';

export const ALL_LAYOUT_KINDS: LayoutKind[] = ['grouped', 'hierarchy', 'organic'];

export type GroupingKind = 'namespace' | 'folder' | 'file' | 'none';

/** `auto` follows the zoom level; `compact` and `full` are pinned (spec §4.3). */
export type DisplayMode = 'auto' | 'compact' | 'full';

export interface Point {
  x: number;
  y: number;
}

export interface CameraState {
  /** World coordinates of the point shown at the center of the view. */
  centerX: number;
  centerY: number;
  /** Screen pixels per world unit. */
  scale: number;
}

export interface DiagramFilters {
  /** Entity kinds to hide. `template` hides every class that has template parameters. */
  hiddenEntityKinds: string[];
  hiddenNamespaces: string[];
  hiddenFolders: string[];
  showExternal: boolean;
}

export interface SavedDiagramState {
  version: 1;
  layout: LayoutKind;
  grouping: GroupingKind;
  /** Top-left corner of each card, per layout, indexed by qualified class name. */
  positions: Partial<Record<LayoutKind, Record<string, Point>>>;
  /** Grouping that was active when the positions of each layout were computed. */
  positionsGrouping: Partial<Record<LayoutKind, GroupingKind>>;
  /** Only pinned classes are listed; the others are in `auto` mode. */
  displayModes: Record<string, 'compact' | 'full'>;
  collapsedGroups: string[];
  activeRelations: RelationKind[];
  filters: DiagramFilters;
  camera?: CameraState;
}

/** The file written by the extension host also remembers how the folder was scanned. */
export interface SavedDiagramFile extends SavedDiagramState {
  scan: {
    /** Scanned folder, relative to the workspace folder that contains the saved file. */
    folder: string;
    depth: number;
  };
}

export function createDefaultState(): SavedDiagramState {
  return {
    version: 1,
    layout: 'grouped',
    grouping: 'namespace',
    positions: {},
    positionsGrouping: {},
    displayModes: {},
    collapsedGroups: [],
    activeRelations: ['inherit'],
    filters: {
      hiddenEntityKinds: [],
      hiddenNamespaces: [],
      hiddenFolders: [],
      showExternal: false,
    },
  };
}

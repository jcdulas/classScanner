// Messages exchanged between the extension host and the webview (spec §5).
//
// Each side only sends the message types listed here. The `type` field lets
// the receiver narrow a message to its exact shape with a switch statement.

import { Graph, RelationKind, ScanReport } from './graphModel';
import { SavedDiagramState } from './savedState';

/** Settings the webview needs to display the diagram. */
export interface DiagramSettings {
  maxMembersInAutoMode: number;
  structuralRelations: RelationKind[];
}

export type ExportFormat = 'png' | 'svg';

/** `view`: what is visible on screen. `diagram`: the whole diagram. `selection`: the selected classes. */
export type ExportScope = 'view' | 'diagram' | 'selection';

export type HostToWebviewMessage =
  | { type: 'scanStarted'; folder: string }
  | { type: 'scanProgress'; parsedFileCount: number; totalFileCount: number }
  | { type: 'scanFailed'; message: string }
  | {
      type: 'graph';
      graph: Graph;
      report: ScanReport;
      savedState: SavedDiagramState | undefined;
      settings: DiagramSettings;
    }
  | { type: 'exportRequest'; format: ExportFormat; scope: ExportScope; scale: number };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'openSource'; file: number; line: number }
  | { type: 'saveState'; state: SavedDiagramState }
  | { type: 'rescan' }
  | { type: 'startExport' }
  | { type: 'showReport' }
  /** PNG data is base64-encoded; SVG data is the SVG text. */
  | { type: 'exportResult'; format: ExportFormat; data: string }
  | { type: 'exportFailed'; message: string }
  | { type: 'diagramShown'; visibleNodeCount: number; layoutDurationMs: number }
  | { type: 'error'; message: string; stack?: string };

// Messages exchanged between the extension host and the webview (spec §5).
//
// Each side only sends the message types listed here. The `type` field lets
// the receiver narrow a message to its exact shape with a switch statement.

import { Graph, RelationKind, ScanReport } from './graphModel';
import { SavedDiagramState } from './savedState';

/** Written into the webview page by the extension host, read by the webview at startup. */
export interface WebviewBootConfig {
  /** URL of the layout web worker script. */
  layoutWorkerUrl: string;
}

/** Settings the webview needs to display the diagram. */
export interface DiagramSettings {
  maxMembersInAutoMode: number;
  structuralRelations: RelationKind[];
}

/** `schema` is the compact text for language models (src/webview/export/llmSchema.ts). */
export type ExportFormat = 'png' | 'svg' | 'schema';

/** `view`: what is visible on screen. `diagram`: the whole diagram. `selection`: the selected classes. */
export type ExportScope = 'view' | 'diagram' | 'selection';

/** Frame times measured while panning at one level of detail (spec §8, used by the integration tests). */
export interface FrameStatistics {
  level: string;
  frameCount: number;
  averageFrameMs: number;
  /** 95% of the frames took less than this. */
  percentile95FrameMs: number;
}

export type HostToWebviewMessage =
  /** `folder` and `depth` are kept by the webview so that VS Code can restore the panel after a restart. */
  | { type: 'scanStarted'; folder: string; depth: number }
  | { type: 'scanProgress'; parsedFileCount: number; totalFileCount: number }
  | { type: 'scanFailed'; message: string }
  | {
      type: 'graph';
      graph: Graph;
      report: ScanReport;
      savedState: SavedDiagramState | undefined;
      settings: DiagramSettings;
    }
  | { type: 'exportRequest'; format: ExportFormat; scope: ExportScope; scale: number }
  | { type: 'selectionRequest' }
  | { type: 'measurePerformance' };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'openSource'; file: number; line: number }
  | { type: 'saveState'; state: SavedDiagramState }
  | { type: 'rescan' }
  | { type: 'startExport' }
  | { type: 'showReport' }
  /** Asks the host to prompt for another scan depth, then to scan again. */
  | { type: 'changeDepth' }
  /** PNG data is base64-encoded; SVG and schema data are text. */
  | { type: 'exportResult'; format: ExportFormat; data: string }
  | { type: 'selectionResult'; nodeIds: string[] }
  /** `description` says what was copied, for the confirmation message. */
  | { type: 'copyToClipboard'; text: string; description: string }
  /** Asks the host to save the source files of these classes in a .zip archive. */
  | { type: 'exportSources'; nodeIds: string[] }
  | { type: 'exportFailed'; message: string }
  | { type: 'diagramShown'; visibleNodeCount: number; layoutDurationMs: number }
  | { type: 'performanceResult'; statistics: FrameStatistics[] }
  | { type: 'error'; message: string; stack?: string };

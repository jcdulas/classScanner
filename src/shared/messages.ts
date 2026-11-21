// Messages exchanged between the extension host and the webview (spec §5).
//
// Each side only sends the message types listed here. The `type` field lets
// the receiver narrow a message to its exact shape with a switch statement.

import { Graph, RelationKind, ScanReport } from './graphModel';
import { SavedDiagramState, SchemaDetail } from './savedState';

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

/** Lines of a file, both included and 1-based. */
export interface LineRange {
  firstLine: number;
  lastLine: number;
  /** For a pure deletion, these are the two lines on either side of the gap (0 at the start of a file). */
  deletionOnly?: true;
}

/** The lines of a file of the graph that changed since a git reference (spec §4.9). */
export interface ChangedFileLines {
  /** Index in Graph.files. */
  file: number;
  ranges: LineRange[];
}

/** A function as a language extension describes it: the lines it covers in a file of the graph, and its name. */
export interface LocatedFunction {
  /** Index in Graph.files. */
  file: number;
  firstLine: number;
  lastLine: number;
  /** Name without its class and its parameters: `area`. */
  name: string;
}

/**
 * A call found by the C++ language extension for a method it was asked about (spec §3.3).
 * `incoming`: `other` calls the method. `outgoing`: the method calls `other`.
 */
export interface PreciseCall {
  direction: 'incoming' | 'outgoing';
  /** The method that was asked about: its class and its name. */
  classId: string;
  method: string;
  other: LocatedFunction;
  /** Where the call is: index in Graph.files and 1-based line. */
  file: number;
  line: number;
}

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
  /** `schemaDetail` is only used by the `schema` format; without it the webview uses its own setting. */
  | { type: 'exportRequest'; format: ExportFormat; scope: ExportScope; scale: number; schemaDetail?: SchemaDetail }
  | { type: 'selectionRequest' }
  | { type: 'measurePerformance' }
  /** Shows the class that a line of a file belongs to: the class under the cursor of the editor (spec §4.6). */
  | { type: 'revealSource'; file: number; line: number }
  /** Answer to `requestChanges`: the lines that changed since `reference`, in the files of the graph. */
  | { type: 'changes'; reference: string; files: ChangedFileLines[] }
  | { type: 'changesFailed'; message: string }
  /**
   * Answer to `requestPreciseCalls`: the calls of the methods of `classIds`, and how many methods
   * were asked about and had no answer. `wasCancelled`: the user stopped before the end, and
   * `classIds` only has the classes that were asked about entirely.
   */
  | { type: 'preciseCalls'; classIds: string[]; calls: PreciseCall[]; askedMethodCount: number; unansweredMethodCount: number; wasCancelled: boolean }
  | { type: 'preciseCallsFailed'; message: string };

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
  /**
   * Asks for the lines that changed since a git reference (spec §4.9). Without `reference`,
   * the host asks the user to choose one.
   */
  | { type: 'requestChanges'; reference?: string }
  /** Asks the C++ language extension for the calls of the methods of these classes (spec §3.3). */
  | { type: 'requestPreciseCalls'; classIds: string[] }
  | { type: 'exportFailed'; message: string }
  | { type: 'diagramShown'; visibleNodeCount: number; layoutDurationMs: number }
  | { type: 'performanceResult'; statistics: FrameStatistics[] }
  | { type: 'error'; message: string; stack?: string };

// Connects the pieces of the webview: messages from the extension host, the
// store, the renderer and the user interface actions.

import { Graph } from '../shared/graphModel';
import { ChangedFileLines, ExportFormat, ExportScope, HostToWebviewMessage, PreciseCall } from '../shared/messages';
import { SchemaDetail } from '../shared/savedState';
import { buildInterfaceText } from './export/interfaceText';
import { buildLlmSchema, estimateTokenCount } from './export/llmSchema';
import { buildSvg } from './export/svgExport';
import { HostConnection } from './hostConnection';
import { FontMetrics } from './model/cardGeometry';
import { addPreciseCalls } from './model/preciseCalls';
import { computeSelectionInterface } from './model/selectionInterface';
import { SourceIndex } from './model/sourceIndex';
import { DiagramRenderer } from './render/diagramRenderer';
import { readTheme } from './render/theme';
import { DiagramStore } from './state/diagramStore';

/** The arrangement is saved this long after the last change (spec §5). */
const SAVE_DELAY_MS = 1000;

export class DiagramController {
  private renderer: DiagramRenderer | undefined;
  private saveTimer: number | undefined;
  /** The index of the lines of the last graph it was asked for (sourceIndex.ts). */
  private sourceIndex: { graph: Graph; index: SourceIndex } | undefined;

  constructor(
    readonly store: DiagramStore,
    private readonly host: HostConnection,
    private readonly metrics: FontMetrics,
  ) {
    store.subscribe((change) => {
      if (DiagramStore.isPersistedChange(change) && store.graph !== undefined && store.phase === 'ready') {
        this.scheduleSave();
      }
    });
    window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
      void this.handleHostMessage(event.data);
    });
    window.addEventListener('error', (event) => this.reportError(event.error ?? event.message));
    window.addEventListener('unhandledrejection', (event) => this.reportError(event.reason));
  }

  /** Creates the WebGL renderer in the element provided by the user interface. */
  async attachRenderer(element: HTMLElement): Promise<void> {
    this.renderer = await DiagramRenderer.create(element, this.store, this.metrics, {
      openSource: (file, line) => this.openSource(file, line),
      onDiagramShown: (visibleNodeCount) =>
        this.host.post({ type: 'diagramShown', visibleNodeCount, layoutDurationMs: this.store.lastLayoutDurationMs }),
    });
    this.host.post({ type: 'ready' });
  }

  // ---- Actions of the user interface ----

  rescan(): void {
    this.host.post({ type: 'rescan' });
  }

  startExport(): void {
    this.host.post({ type: 'startExport' });
  }

  showReport(): void {
    this.host.post({ type: 'showReport' });
  }

  changeDepth(): void {
    this.host.post({ type: 'changeDepth' });
  }

  openSource(file: number, line: number): void {
    this.host.post({ type: 'openSource', file, line });
  }

  focusNode(id: string): void {
    void this.showClasses([id]);
  }

  /**
   * Selects classes and moves the view to them. A collapsed group that hides a single class
   * is expanded; classes hidden by a filter or by the isolation stay hidden, with a message.
   */
  async showClasses(ids: string[]): Promise<void> {
    const store = this.store;
    const knownIds = ids.filter((id) => store.nodeById.has(id));
    if (knownIds.length === 0) {
      return;
    }
    const groupKey = knownIds.length === 1 ? store.groupKeyByNode.get(knownIds[0]) : undefined;
    if (groupKey !== undefined && store.collapsedGroups.has(groupKey)) {
      await store.toggleGroupCollapsed(groupKey);
    }
    store.select(knownIds, 'replace');
    const shownIds = knownIds.filter((id) => store.visibleNodeIds.has(id));
    const hiddenCount = knownIds.length - shownIds.length;
    if (hiddenCount > 0) {
      const what = knownIds.length === 1 ? `${store.nodeById.get(knownIds[0])!.name} is` : `${hiddenCount} of these ${knownIds.length} classes are`;
      store.showWarning(`${what} hidden by a filter or by the isolation.`);
    }
    if (shownIds.length === 1) {
      this.renderer?.focusNode(shownIds[0]);
    } else {
      this.renderer?.showNodes(shownIds);
    }
  }

  /**
   * Asks the host to find the calls of the selected classes with the C++ language extension of
   * VS Code (spec §3.3). The answer completes the interface of the selection.
   */
  requestPreciseCalls(): void {
    if (this.store.selection.size === 0 || this.store.isAskingPreciseCalls) {
      return;
    }
    this.store.startAskingPreciseCalls();
    this.host.post({ type: 'requestPreciseCalls', classIds: Array.from(this.store.selection) });
  }

  /** Asks the host which classes changed since a git reference; without one, the host asks the user (spec §4.9). */
  requestChanges(reference?: string): void {
    this.host.post({ type: 'requestChanges', reference });
  }

  /** Moves the view to a class without selecting it. */
  revealNode(id: string): void {
    this.renderer?.focusNode(id);
  }

  /** Copies the interface of the selected classes with the rest of the code, as text, to the clipboard (spec §4.8). */
  copySelectionInterface(): void {
    const graph = this.store.graph;
    const selection = this.store.selection;
    if (graph === undefined || selection.size === 0) {
      return;
    }
    const selectionInterface = computeSelectionInterface(graph, selection, this.store.preciseCalls);
    const text = buildInterfaceText(graph, selection, selectionInterface, this.projectName(graph.root));
    this.host.post({ type: 'copyToClipboard', text, description: `Interface of ${selection.size} ${selection.size === 1 ? 'class' : 'classes'}` });
  }

  /** Copies the schema of the selected classes, for a language model, to the clipboard. */
  copySelectionAsSchema(): void {
    try {
      const text = this.buildSchema('selection', this.store.schemaDetail);
      const count = this.store.selection.size;
      this.host.post({ type: 'copyToClipboard', text, description: `Schema of ${count} ${count === 1 ? 'class' : 'classes'}` });
    } catch (error) {
      this.store.showWarning(error instanceof Error ? error.message : String(error));
    }
  }

  /** A rough size, in tokens, of the schema of the selection with the current detail options. */
  estimateSelectionSchemaTokens(): number | undefined {
    try {
      return estimateTokenCount(this.buildSchema('selection', this.store.schemaDetail));
    } catch {
      return undefined;
    }
  }

  /** Asks the extension host to save the source files of the selected classes in a .zip archive. */
  exportSelectionSources(): void {
    this.host.post({ type: 'exportSources', nodeIds: Array.from(this.store.selection) });
  }

  fitToView(): void {
    this.renderer?.fitToView();
  }

  zoomBy(factor: number): void {
    this.renderer?.zoomBy(factor);
  }

  // ---- Messages from the extension host ----

  private async handleHostMessage(message: HostToWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'scanStarted':
        this.flushSave();
        this.host.rememberScanTarget(message.folder, message.depth);
        this.store.startScan();
        return;
      case 'scanProgress':
        this.store.setScanProgress(message.parsedFileCount, message.totalFileCount);
        return;
      case 'scanFailed':
        this.store.failScan(message.message);
        return;
      case 'graph':
        this.store.forgetPreciseCalls();
        await this.store.loadGraph(message.graph, message.report, message.savedState, message.settings);
        // The lines of the list of changes are those of the previous scan: it is asked again.
        if (this.store.changes !== undefined) {
          this.requestChanges(this.store.changes.reference);
        }
        return;
      case 'revealSource':
        await this.revealSource(message.file, message.line);
        return;
      case 'changes':
        this.receiveChanges(message.reference, message.files);
        return;
      case 'changesFailed':
        this.store.failChanges(message.message);
        return;
      case 'preciseCalls':
        this.receivePreciseCalls(message.classIds, message.calls, message.askedMethodCount, message.unansweredMethodCount, message.wasCancelled);
        return;
      case 'preciseCallsFailed':
        this.store.finishAskingPreciseCalls(message.message);
        return;
      case 'exportRequest':
        await this.handleExportRequest(message.format, message.scope, message.scale, message.schemaDetail ?? this.store.schemaDetail);
        return;
      case 'selectionRequest':
        this.host.post({ type: 'selectionResult', nodeIds: Array.from(this.store.selection) });
        return;
      case 'measurePerformance':
        if (this.renderer !== undefined) {
          this.host.post({ type: 'performanceResult', statistics: await this.renderer.measurePerformance() });
        }
        return;
    }
  }

  /** Shows the class that a line of a file belongs to: the class under the cursor of the editor (spec §4.6). */
  private async revealSource(file: number, line: number): Promise<void> {
    const graph = this.store.graph;
    if (graph === undefined) {
      return;
    }
    const classId = this.sourceIndexOf(graph).classToShowAt(file, line);
    if (classId === undefined) {
      this.store.showWarning(`No class of the diagram at line ${line} of ${graph.files[file] ?? 'this file'}.`);
      return;
    }
    await this.showClasses([classId]);
  }

  /** Turns the changed lines sent by the host into the list of the classes that they belong to. */
  private receiveChanges(reference: string, files: ChangedFileLines[]): void {
    const graph = this.store.graph;
    if (graph === undefined) {
      return;
    }
    const index = this.sourceIndexOf(graph);
    const classIds = new Set<string>();
    for (const changedFile of files) {
      for (const range of changedFile.ranges) {
        for (const classId of index.classesInRange(changedFile.file, range)) {
          classIds.add(classId);
        }
      }
    }
    this.store.setChanges({ reference, classIds: Array.from(classIds).sort(), changedFileCount: files.length });
  }

  /** Adds the calls found by the C++ language extension to those already known, and says what was checked. */
  private receivePreciseCalls(classIds: string[], calls: PreciseCall[], askedCount: number, unansweredCount: number, wasCancelled: boolean): void {
    const graph = this.store.graph;
    if (graph === undefined) {
      return;
    }
    const preciseCalls = addPreciseCalls(this.store.preciseCalls, classIds, calls, this.sourceIndexOf(graph));
    const parts = [wasCancelled ? 'Stopped before the end.' : `${askedCount - unansweredCount} of ${askedCount} methods checked.`];
    if (unansweredCount > 0 && !wasCancelled) {
      parts.push(`${unansweredCount} have no code in the project (declared only, or defined elsewhere): the C++ extension does not know who calls them.`);
    }
    this.store.finishAskingPreciseCalls(parts.join(' '), preciseCalls);
  }

  private sourceIndexOf(graph: Graph): SourceIndex {
    if (this.sourceIndex?.graph !== graph) {
      this.sourceIndex = { graph, index: new SourceIndex(graph) };
    }
    return this.sourceIndex.index;
  }

  private async handleExportRequest(format: ExportFormat, scope: ExportScope, scale: number, schemaDetail: SchemaDetail): Promise<void> {
    try {
      let data: string;
      if (format === 'schema') {
        data = this.buildSchema(scope === 'selection' ? 'selection' : 'diagram', schemaDetail);
      } else if (format === 'svg') {
        data = buildSvg(this.store, readTheme(), scope === 'selection' ? 'selection' : 'diagram');
      } else if (this.renderer === undefined) {
        throw new Error('The diagram is not ready yet.');
      } else {
        data = await this.renderer.exportPng(scope === 'view' ? 'view' : 'diagram', scale);
      }
      this.host.post({ type: 'exportResult', format, data });
    } catch (error) {
      this.host.post({ type: 'exportFailed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** The schema of the selected classes, or of every visible class, with the active relations. */
  private buildSchema(scope: 'selection' | 'diagram', detail: SchemaDetail): string {
    const graph = this.store.graph;
    if (graph === undefined) {
      throw new Error('The diagram is not ready yet.');
    }
    const ids = scope === 'selection' ? Array.from(this.store.selection) : Array.from(this.store.visibleNodeIds);
    if (ids.length === 0) {
      throw new Error(scope === 'selection' ? 'No class is selected.' : 'No class is visible.');
    }
    return buildLlmSchema(graph, ids, { projectName: this.projectName(graph.root), relationKinds: this.store.activeRelations, detail });
  }

  /** The name of the folder the user scanned; the root of the graph can be its parent (spec §2.2). */
  private projectName(graphRoot: string): string {
    const scannedFolder = this.store.report?.folder ?? graphRoot;
    return scannedFolder.split(/[\\/]/).filter((part) => part !== '').pop() ?? scannedFolder;
  }

  // ---- Persistence ----

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private flushSave(): void {
    if (this.saveTimer === undefined) {
      return;
    }
    window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.host.post({ type: 'saveState', state: this.store.toSavedState() });
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.host.post({ type: 'error', message, stack });
  }
}

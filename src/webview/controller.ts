// Connects the pieces of the webview: messages from the extension host, the
// store, the renderer and the user interface actions.

import { ExportFormat, ExportScope, HostToWebviewMessage } from '../shared/messages';
import { buildLlmSchema } from './export/llmSchema';
import { buildSvg } from './export/svgExport';
import { HostConnection } from './hostConnection';
import { FontMetrics } from './model/cardGeometry';
import { DiagramRenderer } from './render/diagramRenderer';
import { readTheme } from './render/theme';
import { DiagramStore } from './state/diagramStore';

/** The arrangement is saved this long after the last change (spec §5). */
const SAVE_DELAY_MS = 1000;

export class DiagramController {
  private renderer: DiagramRenderer | undefined;
  private saveTimer: number | undefined;

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

  openSource(file: number, line: number): void {
    this.host.post({ type: 'openSource', file, line });
  }

  focusNode(id: string): void {
    this.store.select([id], 'replace');
    this.renderer?.focusNode(id);
  }

  /** Copies the schema of the selected classes, for a language model, to the clipboard. */
  copySelectionAsSchema(): void {
    try {
      const text = this.buildSchema('selection');
      const count = this.store.selection.size;
      this.host.post({ type: 'copyToClipboard', text, description: `Schema of ${count} ${count === 1 ? 'class' : 'classes'}` });
    } catch (error) {
      this.store.showWarning(error instanceof Error ? error.message : String(error));
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
        await this.store.loadGraph(message.graph, message.report, message.savedState, message.settings);
        return;
      case 'exportRequest':
        await this.handleExportRequest(message.format, message.scope, message.scale);
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

  private async handleExportRequest(format: ExportFormat, scope: ExportScope, scale: number): Promise<void> {
    try {
      let data: string;
      if (format === 'schema') {
        data = this.buildSchema(scope === 'selection' ? 'selection' : 'diagram');
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
  private buildSchema(scope: 'selection' | 'diagram'): string {
    const graph = this.store.graph;
    if (graph === undefined) {
      throw new Error('The diagram is not ready yet.');
    }
    const ids = scope === 'selection' ? Array.from(this.store.selection) : Array.from(this.store.visibleNodeIds);
    if (ids.length === 0) {
      throw new Error(scope === 'selection' ? 'No class is selected.' : 'No class is visible.');
    }
    const projectName = graph.root.split(/[\\/]/).filter((part) => part !== '').pop() ?? graph.root;
    return buildLlmSchema(graph, ids, { projectName, relationKinds: this.store.activeRelations });
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

// One diagram panel: a webview that shows the class diagram of one scanned folder.
//
// The panel runs the scan, sends the graph and the saved arrangement to the
// webview, and answers the webview's requests (open a file, save the
// arrangement, export). Communication goes through the typed messages of
// src/shared/messages.ts.

import path from 'node:path';
import * as vscode from 'vscode';
import { ScanCancelledError, createWorkerParseFunction } from '../scanner/parserPool';
import { ScanResult, scanFolder } from '../scanner/scanFolder';
import { ExportFormat, ExportScope, FrameStatistics, HostToWebviewMessage, WebviewToHostMessage } from '../shared/messages';
import { SavedDiagramState, SchemaDetail } from '../shared/savedState';
import { collectSourceFiles } from '../model/sourceFiles';
import { Graph } from '../shared/graphModel';
import { readSettings } from './configuration';
import { logScanReport } from './scanReportLog';
import { ArchiveLayout, writeSourceArchive } from './sourceArchive';
import { StateStore } from './stateStore';
import { buildWebviewHtml } from './webviewHtml';

export const DIAGRAM_VIEW_TYPE = 'classScanner.diagram';

/** Delay between the save of a file and the automatic scan, to group several saves in one scan. */
const RESCAN_DELAY_MS = 1000;

export interface ScanTarget {
  folder: string;
  depth: number;
}

/** Services shared by every panel, created once in extension.ts. */
export interface PanelServices {
  extensionUri: vscode.Uri;
  globalStorageFolder: string;
  output: vscode.OutputChannel;
  onDidBecomeActive: (panel: DiagramPanel) => void;
  onDidDispose: (panel: DiagramPanel) => void;
  onDiagramShown: (info: { visibleNodeCount: number; layoutDurationMs: number }) => void;
  onWebviewError: (message: string) => void;
}

interface PendingExport {
  resolve: (data: string) => void;
  reject: (error: Error) => void;
}

export class DiagramPanel {
  private target: ScanTarget;
  private stateStore: StateStore;
  private isWebviewReady = false;
  /** The graph message waits here when the scan finishes before the webview has loaded. */
  private pendingGraphMessage: HostToWebviewMessage | undefined;
  private pendingExport: PendingExport | undefined;
  private scanCancellation: vscode.CancellationTokenSource | undefined;
  /** The last graph sent; the webview refers to files by their index in `files`. */
  private lastGraph: Graph | undefined;
  /** The header or source folder scanned together with the folder of the panel (spec §2.2). */
  private pairedFolder: string | undefined;
  private pendingPerformanceMeasure: ((statistics: FrameStatistics[]) => void) | undefined;
  private pendingSelectionRequest: ((nodeIds: string[]) => void) | undefined;
  private rescanTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly webviewPanel: vscode.WebviewPanel,
    target: ScanTarget,
    private readonly services: PanelServices,
  ) {
    this.target = target;
    this.stateStore = new StateStore(target.folder, services.globalStorageFolder);
    const distFolder = vscode.Uri.joinPath(services.extensionUri, 'dist', 'webview');
    webviewPanel.webview.options = { enableScripts: true, localResourceRoots: [distFolder] };
    webviewPanel.webview.html = buildWebviewHtml(webviewPanel.webview, services.extensionUri);
    this.disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.handleMessage(message)),
      webviewPanel.onDidChangeViewState(() => {
        if (webviewPanel.active) {
          services.onDidBecomeActive(this);
        }
      }),
      webviewPanel.onDidDispose(() => this.dispose()),
      vscode.workspace.onDidSaveTextDocument((document) => this.onDocumentSaved(document)),
    );
  }

  static create(target: ScanTarget, services: PanelServices): DiagramPanel {
    const webviewPanel = vscode.window.createWebviewPanel(
      DIAGRAM_VIEW_TYPE,
      panelTitle(target.folder),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // Keeps the WebGL scene alive when the tab is hidden, so switching tabs does not recompute the layout.
        retainContextWhenHidden: true,
      },
    );
    return new DiagramPanel(webviewPanel, target, services);
  }

  get folder(): string {
    return this.target.folder;
  }

  get depth(): number {
    return this.target.depth;
  }

  /**
   * Scans again shortly after a C++ file of the scanned folder is saved (spec §2.1), unless
   * the setting classScanner.rescanOnSave is off. Several saves in a row give one scan.
   */
  private onDocumentSaved(document: vscode.TextDocument): void {
    const settings = readSettings();
    if (!settings.rescanOnSave || document.uri.scheme !== 'file') {
      return;
    }
    const extensions = settings.extensions.map((extension) => extension.toLowerCase());
    if (!extensions.includes(path.extname(document.uri.fsPath).toLowerCase())) {
      return;
    }
    const scannedFolders = this.pairedFolder === undefined ? [this.target.folder] : [this.target.folder, this.pairedFolder];
    if (!scannedFolders.some((folder) => this.isScannedIn(folder, document.uri.fsPath))) {
      return;
    }
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => void this.scan(undefined, true), RESCAN_DELAY_MS);
  }

  /** True when the scan of `folder` reaches the file: it is inside, and not deeper than the scan goes. */
  private isScannedIn(folder: string, filePath: string): boolean {
    const relativePath = path.relative(folder, filePath);
    const isInsideFolder = relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    const folderDepth = relativePath.split(path.sep).length - 1;
    return isInsideFolder && (this.target.depth < 0 || folderDepth <= this.target.depth);
  }

  reveal(): void {
    this.webviewPanel.reveal();
  }

  /**
   * Runs a complete scan, then sends the graph to the webview (spec §2.1). An automatic scan
   * (after a file was saved) shows its progress in the status bar and stays quiet on failure.
   */
  async scan(newDepth?: number, isAutomatic = false): Promise<void> {
    if (newDepth !== undefined) {
      this.target = { ...this.target, depth: newDepth };
    }
    clearTimeout(this.rescanTimer);
    this.scanCancellation?.cancel();
    const cancellation = new vscode.CancellationTokenSource();
    this.scanCancellation = cancellation;
    this.post({ type: 'scanStarted', folder: this.target.folder, depth: this.target.depth });

    try {
      const result = await vscode.window.withProgress(
        isAutomatic
          ? { location: vscode.ProgressLocation.Window, title: 'classScanner: scanning' }
          : { location: vscode.ProgressLocation.Notification, title: 'classScanner', cancellable: true },
        (progress, progressToken) => {
          progressToken.onCancellationRequested(() => cancellation.cancel());
          return this.runScan(progress, cancellation.token);
        },
      );
      logScanReport(this.services.output, result.report);
      this.pairedFolder = result.report.pairedFolder;
      await this.sendGraph(result);
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        this.post({ type: 'scanFailed', message: 'The scan was cancelled.' });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.services.output.appendLine(`Scan failed: ${message}`);
      this.post({ type: 'scanFailed', message });
      if (!isAutomatic) {
        void vscode.window.showErrorMessage(`classScanner: the scan failed. ${message}`);
      }
    }
  }

  /** Asks the webview for export data: base64 PNG, SVG text or schema text. */
  requestExport(format: ExportFormat, scope: ExportScope, scale: number, schemaDetail?: SchemaDetail): Promise<string> {
    this.pendingExport?.reject(new Error('Replaced by a newer export'));
    return new Promise((resolve, reject) => {
      this.pendingExport = { resolve, reject };
      this.post({ type: 'exportRequest', format, scope, scale, schemaDetail });
    });
  }

  /** The qualified names of the classes selected in the diagram. */
  requestSelection(): Promise<string[]> {
    return new Promise((resolve) => {
      this.pendingSelectionRequest = resolve;
      this.post({ type: 'selectionRequest' });
    });
  }

  /**
   * Asks how to lay out the archive and where to save it, then saves the source files of the
   * classes in a .zip archive (spec §4.7).
   */
  async exportSources(nodeIds: string[], layout?: ArchiveLayout): Promise<void> {
    if (nodeIds.length === 0) {
      void vscode.window.showInformationMessage('classScanner: select the classes whose sources to export first.');
      return;
    }
    const chosenLayout = layout ?? (await askArchiveLayout());
    if (chosenLayout === undefined) {
      return;
    }
    const defaultFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(this.target.folder);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(defaultFolder, `${path.basename(this.target.folder)}-sources.zip`)),
      filters: { 'Zip archive': ['zip'] },
    });
    if (target === undefined) {
      return;
    }
    const fileCount = await this.writeSourceArchive(nodeIds, chosenLayout, target.fsPath);
    void vscode.window.showInformationMessage(`classScanner: ${fileCount} source files saved to ${target.fsPath}`);
  }

  /** Writes the archive without asking anything. Returns the number of files written. */
  async writeSourceArchive(nodeIds: string[], layout: ArchiveLayout, targetPath: string): Promise<number> {
    if (this.lastGraph === undefined) {
      throw new Error('The folder has not been scanned yet.');
    }
    const files = collectSourceFiles(this.lastGraph, nodeIds);
    return writeSourceArchive(this.lastGraph.root, files, layout, targetPath);
  }

  /** Asks the webview to measure frame times while panning (spec §8). Used by the integration tests. */
  measurePerformance(): Promise<FrameStatistics[]> {
    return new Promise((resolve) => {
      this.pendingPerformanceMeasure = resolve;
      this.post({ type: 'measurePerformance' });
    });
  }

  dispose(): void {
    clearTimeout(this.rescanTimer);
    this.scanCancellation?.cancel();
    this.pendingExport?.reject(new Error('The diagram was closed'));
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.services.onDidDispose(this);
  }

  private runScan(
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<ScanResult> {
    const settings = readSettings();
    const workerScript = vscode.Uri.joinPath(this.services.extensionUri, 'dist', 'parserWorker.js').fsPath;
    let lastReportedPercent = 0;
    progress.report({ message: `Listing files in ${path.basename(this.target.folder)}...` });

    return scanFolder({
      folder: this.target.folder,
      discovery: {
        maxDepth: this.target.depth,
        extensions: settings.extensions,
        exclude: settings.exclude,
      },
      parseFiles: createWorkerParseFunction(workerScript, {
        ignoredMacros: settings.ignoredMacros,
        maxFileSizeBytes: settings.maxFileSizeKB * 1024,
      }),
      isCancelled: () => token.isCancellationRequested,
      onProgress: (parsedFileCount, totalFileCount) => {
        const percent = Math.floor((parsedFileCount / Math.max(1, totalFileCount)) * 100);
        progress.report({ message: `Parsing ${parsedFileCount} / ${totalFileCount} files`, increment: percent - lastReportedPercent });
        lastReportedPercent = percent;
        this.post({ type: 'scanProgress', parsedFileCount, totalFileCount });
      },
    });
  }

  private async sendGraph(result: ScanResult): Promise<void> {
    const settings = readSettings();
    const savedFile = await this.stateStore.read();
    let savedState: SavedDiagramState | undefined;
    if (savedFile !== undefined) {
      // The scan information is only needed by the host; the webview gets the rest.
      const { scan: _scan, ...state } = savedFile;
      savedState = state;
    }
    this.post({
      type: 'graph',
      graph: result.graph,
      report: result.report,
      savedState,
      settings: {
        maxMembersInAutoMode: settings.maxMembersInAutoMode,
        structuralRelations: settings.structuralRelations,
      },
    });
  }

  private handleMessage(message: WebviewToHostMessage): void {
    switch (message.type) {
      case 'ready':
        this.isWebviewReady = true;
        if (this.pendingGraphMessage !== undefined) {
          void this.webviewPanel.webview.postMessage(this.pendingGraphMessage);
          this.pendingGraphMessage = undefined;
        }
        return;
      case 'openSource': {
        const relativePath = this.lastGraph?.files[message.file];
        if (relativePath !== undefined) {
          void this.openSourceFile(relativePath, message.line);
        }
        return;
      }
      case 'saveState':
        this.stateStore.write(message.state, this.target.depth).catch((error: unknown) => {
          this.services.output.appendLine(`Could not save the diagram arrangement: ${String(error)}`);
        });
        return;
      case 'rescan':
        void this.scan();
        return;
      case 'startExport':
        void vscode.commands.executeCommand('classScanner.exportDiagram');
        return;
      case 'showReport':
        this.services.output.show(true);
        return;
      case 'changeDepth':
        void vscode.commands.executeCommand('classScanner.changeDepth');
        return;
      case 'exportResult':
        this.pendingExport?.resolve(message.data);
        this.pendingExport = undefined;
        return;
      case 'exportFailed':
        this.pendingExport?.reject(new Error(message.message));
        this.pendingExport = undefined;
        return;
      case 'selectionResult':
        this.pendingSelectionRequest?.(message.nodeIds);
        this.pendingSelectionRequest = undefined;
        return;
      case 'copyToClipboard':
        void vscode.env.clipboard.writeText(message.text).then(() => {
          void vscode.window.showInformationMessage(`classScanner: ${message.description} copied to the clipboard.`);
        });
        return;
      case 'exportSources':
        this.exportSources(message.nodeIds).catch((error: unknown) => {
          void vscode.window.showErrorMessage(`classScanner: the export failed. ${String(error)}`);
        });
        return;
      case 'performanceResult':
        this.pendingPerformanceMeasure?.(message.statistics);
        this.pendingPerformanceMeasure = undefined;
        return;
      case 'diagramShown':
        this.services.onDiagramShown({ visibleNodeCount: message.visibleNodeCount, layoutDurationMs: message.layoutDurationMs });
        return;
      case 'error':
        this.services.output.appendLine(`Webview error: ${message.message}${message.stack ? `\n${message.stack}` : ''}`);
        this.services.onWebviewError(message.message);
        return;
    }
  }

  /** Opens a file of the last graph in the editor, at a 1-based line (spec §4.6). */
  async openSourceFile(relativePath: string, line: number): Promise<void> {
    if (this.lastGraph === undefined) {
      return;
    }
    const uri = vscode.Uri.file(path.join(this.lastGraph.root, relativePath));
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    await vscode.window.showTextDocument(uri, {
      viewColumn: this.columnToOpenIn(uri),
      selection: new vscode.Range(position, position),
      preview: true,
    });
  }

  /**
   * The editor column in which to show a file, chosen so that a file is never opened twice.
   *
   * A file that already has a tab in another column is shown there. Otherwise files go to the
   * column on the right of the diagram, always the same one. `ViewColumn.Beside` cannot be
   * used: it means "beside the active editor", and after a first file was opened the active
   * editor is that file, so the next one opened in a third column, and so on.
   */
  private columnToOpenIn(uri: vscode.Uri): vscode.ViewColumn {
    const diagramColumn = this.webviewPanel.viewColumn;
    for (const group of vscode.window.tabGroups.all) {
      // A tab in the column of the diagram does not count: showing it would hide the diagram.
      if (group.viewColumn === diagramColumn) {
        continue;
      }
      const showsFile = group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && isSameFile(tab.input.uri, uri));
      if (showsFile) {
        return group.viewColumn;
      }
    }
    return diagramColumn === undefined ? vscode.ViewColumn.Beside : diagramColumn + 1;
  }

  private post(message: HostToWebviewMessage): void {
    if (message.type === 'graph') {
      this.lastGraph = message.graph;
      if (!this.isWebviewReady) {
        this.pendingGraphMessage = message;
        return;
      }
    }
    void this.webviewPanel.webview.postMessage(message);
  }
}

async function askArchiveLayout(): Promise<ArchiveLayout | undefined> {
  const choices: (vscode.QuickPickItem & { layout: ArchiveLayout })[] = [
    { label: 'Keep the folder tree', description: 'inc/core/engine.h, src/core/engine.cpp', layout: 'tree' },
    { label: 'Flat', description: 'every file at the root of the archive', layout: 'flat' },
  ];
  const choice = await vscode.window.showQuickPick(choices, { title: 'Layout of the .zip archive' });
  return choice?.layout;
}

/** Windows paths are case-insensitive: the same file can be written with another case there. */
function isSameFile(first: vscode.Uri, second: vscode.Uri): boolean {
  if (process.platform === 'win32') {
    return first.fsPath.toLowerCase() === second.fsPath.toLowerCase();
  }
  return first.fsPath === second.fsPath;
}

function panelTitle(folder: string): string {
  return `Classes: ${path.basename(folder)}`;
}

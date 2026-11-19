// Entry point of the extension: registers the commands and keeps track of the open diagrams.
//
// There is one diagram panel per scanned folder. Scanning a folder that
// already has a panel reveals it and scans again. The "active" panel is the
// one the Rescan and Export commands apply to.

import * as vscode from 'vscode';
import { ExportFormat, ExportScope, FrameStatistics } from '../shared/messages';
import { SchemaDetail } from '../shared/savedState';
import { DIAGRAM_VIEW_TYPE, DiagramPanel, PanelServices, ScanTarget } from './diagramPanel';
import { readSettings } from './configuration';
import { runExportFlow } from './exportFlow';
import { ArchiveLayout } from './sourceArchive';
import { StateStore } from './stateStore';

const LAST_DEPTH_KEY = 'classScanner.lastDepth';
const ACTIVE_CONTEXT_KEY = 'classScanner.diagramIsActive';

/** Returned by `activate`, for the integration tests. */
export interface ClassScannerApi {
  onDiagramShown: vscode.Event<{ visibleNodeCount: number; layoutDurationMs: number }>;
  onWebviewError: vscode.Event<string>;
  scanFolder(folder: string, depth: number): Promise<void>;
  /** Export data of the active diagram: base64 PNG or SVG text. */
  exportActiveDiagram(format: ExportFormat, scope: ExportScope, scale: number, schemaDetail?: SchemaDetail): Promise<string>;
  measureActiveDiagramPerformance(): Promise<FrameStatistics[]>;
  /** Saves the sources of the given classes of the active diagram; returns the number of files. */
  exportActiveDiagramSources(nodeIds: string[], layout: ArchiveLayout, targetPath: string): Promise<number>;
}

/** The state VS Code keeps for a panel across restarts (set by the webview with `setState`). */
interface PersistedPanelState {
  folder?: string;
  depth?: number;
}

export function activate(context: vscode.ExtensionContext): ClassScannerApi {
  const output = vscode.window.createOutputChannel('classScanner');
  const panels = new Map<string, DiagramPanel>();
  let activePanel: DiagramPanel | undefined;
  const diagramShown = new vscode.EventEmitter<{ visibleNodeCount: number; layoutDurationMs: number }>();
  const webviewError = new vscode.EventEmitter<string>();

  const setActivePanel = (panel: DiagramPanel | undefined) => {
    activePanel = panel;
    void vscode.commands.executeCommand('setContext', ACTIVE_CONTEXT_KEY, panel !== undefined);
  };

  const services: PanelServices = {
    extensionUri: context.extensionUri,
    globalStorageFolder: context.globalStorageUri.fsPath,
    output,
    onDidBecomeActive: (panel) => setActivePanel(panel),
    onDidDispose: (panel) => {
      panels.delete(panelKey(panel.folder));
      if (activePanel === panel) {
        setActivePanel(undefined);
      }
    },
    onDiagramShown: (info) => diagramShown.fire(info),
    onWebviewError: (message) => webviewError.fire(message),
  };

  const openDiagram = async (target: ScanTarget): Promise<void> => {
    let panel = panels.get(panelKey(target.folder));
    if (panel === undefined) {
      panel = DiagramPanel.create(target, services);
      panels.set(panelKey(target.folder), panel);
    } else {
      panel.reveal();
    }
    setActivePanel(panel);
    await panel.scan(target.depth);
  };

  context.subscriptions.push(
    output,
    diagramShown,
    webviewError,
    vscode.commands.registerCommand('classScanner.scanFolder', async (uri?: vscode.Uri) => {
      const folder = uri?.fsPath ?? (await pickFolder());
      if (folder === undefined) {
        return;
      }
      // A folder that was already scanned keeps its depth: it is asked only the first time
      // (spec §2.2). "Change Scan Depth" changes it afterwards.
      const savedState = await new StateStore(folder, context.globalStorageUri.fsPath).read();
      const depth = savedState?.scan.depth ?? (await askDepth(context, undefined));
      if (depth === undefined) {
        return;
      }
      await openDiagram({ folder, depth });
    }),
    vscode.commands.registerCommand('classScanner.changeDepth', async () => {
      if (activePanel === undefined) {
        void vscode.window.showInformationMessage('classScanner: open a diagram first.');
        return;
      }
      const depth = await askDepth(context, activePanel.depth);
      if (depth !== undefined) {
        await activePanel.scan(depth);
      }
    }),
    vscode.commands.registerCommand('classScanner.rescan', async () => {
      if (activePanel === undefined) {
        void vscode.window.showInformationMessage('classScanner: open a diagram first.');
        return;
      }
      await activePanel.scan();
    }),
    vscode.commands.registerCommand('classScanner.exportDiagram', async () => {
      if (activePanel === undefined) {
        void vscode.window.showInformationMessage('classScanner: open a diagram first.');
        return;
      }
      try {
        await runExportFlow(activePanel);
      } catch (error) {
        void vscode.window.showErrorMessage(`classScanner: the export failed. ${String(error)}`);
      }
    }),
    // Restores the diagrams that were open when VS Code was closed: they are scanned again (spec §2.1).
    vscode.window.registerWebviewPanelSerializer(DIAGRAM_VIEW_TYPE, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: PersistedPanelState | undefined) {
        if (state?.folder === undefined) {
          webviewPanel.dispose();
          return;
        }
        const target: ScanTarget = { folder: state.folder, depth: state.depth ?? -1 };
        const panel = new DiagramPanel(webviewPanel, target, services);
        panels.set(panelKey(target.folder), panel);
        await panel.scan();
      },
    }),
  );

  return {
    onDiagramShown: diagramShown.event,
    onWebviewError: webviewError.event,
    scanFolder: (folder, depth) => openDiagram({ folder, depth }),
    exportActiveDiagram: (format, scope, scale, schemaDetail) => {
      if (activePanel === undefined) {
        return Promise.reject(new Error('No active diagram'));
      }
      return activePanel.requestExport(format, scope, scale, schemaDetail);
    },
    measureActiveDiagramPerformance: () => {
      if (activePanel === undefined) {
        return Promise.reject(new Error('No active diagram'));
      }
      return activePanel.measurePerformance();
    },
    exportActiveDiagramSources: (nodeIds, layout, targetPath) => {
      if (activePanel === undefined) {
        return Promise.reject(new Error('No active diagram'));
      }
      return activePanel.writeSourceArchive(nodeIds, layout, targetPath);
    },
  };
}

export function deactivate(): void {
  // Panels and workers are disposed through context.subscriptions and panel disposal.
}

/** Windows paths are case-insensitive, so the panel key ignores case there. */
function panelKey(folder: string): string {
  return process.platform === 'win32' ? folder.toLowerCase() : folder;
}

async function pickFolder(): Promise<string | undefined> {
  const selection = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: 'Scan Folder',
  });
  return selection?.[0]?.fsPath;
}

/** Asks for the scan depth, prefilled with the depth of the diagram or the last value used (spec §2.2). */
async function askDepth(context: vscode.ExtensionContext, currentDepth: number | undefined): Promise<number | undefined> {
  const lastDepth = currentDepth ?? context.globalState.get<number>(LAST_DEPTH_KEY) ?? readSettings().maxDepth;
  const answer = await vscode.window.showInputBox({
    title: 'Scan depth',
    prompt: '0 scans only the files in the folder, N goes N levels of subfolders deep, -1 is unlimited.',
    value: String(lastDepth),
    validateInput: (value) => (/^-?\d+$/.test(value.trim()) && Number(value) >= -1 ? undefined : 'Enter -1 or a positive whole number.'),
  });
  if (answer === undefined) {
    return undefined;
  }
  const depth = Number(answer.trim());
  await context.globalState.update(LAST_DEPTH_KEY, depth);
  return depth;
}

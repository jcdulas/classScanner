// The "Export Diagram" command flow (spec §4.7): choose what to export, let
// the webview render it, then save it where the user wants.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { ExportFormat, ExportScope } from '../shared/messages';
import { DiagramPanel } from './diagramPanel';

interface ExportChoice extends vscode.QuickPickItem {
  format: ExportFormat;
  scope: ExportScope;
}

const EXPORT_CHOICES: ExportChoice[] = [
  { label: 'PNG: current view', format: 'png', scope: 'view' },
  { label: 'PNG: whole diagram', format: 'png', scope: 'diagram' },
  { label: 'SVG: whole diagram', description: 'Selectable text', format: 'svg', scope: 'diagram' },
  { label: 'SVG: selected classes', description: 'Selectable text', format: 'svg', scope: 'selection' },
];

const SCALE_CHOICES = ['1', '2', '4'];

export async function runExportFlow(panel: DiagramPanel): Promise<void> {
  const choice = await vscode.window.showQuickPick(EXPORT_CHOICES, { title: 'Export Diagram' });
  if (choice === undefined) {
    return;
  }
  let scale = 1;
  if (choice.format === 'png') {
    const scaleText = await vscode.window.showQuickPick(SCALE_CHOICES, { title: 'Scale factor of the image' });
    if (scaleText === undefined) {
      return;
    }
    scale = Number(scaleText);
  }

  const data = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'classScanner: rendering the export...' },
    () => panel.requestExport(choice.format, choice.scope, scale),
  );

  const defaultName = `${path.basename(panel.folder)}-classes.${choice.format}`;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? panel.folder;
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceFolder, defaultName)),
    filters: choice.format === 'png' ? { 'PNG image': ['png'] } : { 'SVG image': ['svg'] },
  });
  if (target === undefined) {
    return;
  }
  const content = choice.format === 'png' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
  await writeFile(target.fsPath, content);
  void vscode.window.showInformationMessage(`classScanner: diagram exported to ${target.fsPath}`);
}

// The "Export Diagram" command flow (spec §4.7): choose what to export, let
// the webview produce it, then save it where the user wants (or copy it).

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { ExportFormat, ExportScope } from '../shared/messages';
import { DiagramPanel } from './diagramPanel';

/** `format: 'sources'` is the .zip archive of source files, which the host builds itself. */
interface ExportChoice extends vscode.QuickPickItem {
  format: ExportFormat | 'sources';
  scope: ExportScope;
}

const EXPORT_CHOICES: ExportChoice[] = [
  { label: 'PNG: current view', format: 'png', scope: 'view' },
  { label: 'PNG: whole diagram', format: 'png', scope: 'diagram' },
  { label: 'SVG: whole diagram', description: 'Selectable text', format: 'svg', scope: 'diagram' },
  { label: 'SVG: selected classes', description: 'Selectable text', format: 'svg', scope: 'selection' },
  { label: 'Schema for an LLM: selected classes', description: 'Compact text', format: 'schema', scope: 'selection' },
  { label: 'Schema for an LLM: visible classes', description: 'Compact text', format: 'schema', scope: 'diagram' },
  { label: 'Sources of the selected classes (.zip)', description: 'Headers and .cpp files', format: 'sources', scope: 'selection' },
];

const SCALE_CHOICES = ['1', '2', '4'];

export async function runExportFlow(panel: DiagramPanel): Promise<void> {
  const choice = await vscode.window.showQuickPick(EXPORT_CHOICES, { title: 'Export Diagram' });
  if (choice === undefined) {
    return;
  }
  if (choice.format === 'sources') {
    await panel.exportSources(await panel.requestSelection());
  } else if (choice.format === 'schema') {
    await exportSchema(panel, choice.scope);
  } else {
    await exportImage(panel, choice.format, choice.scope);
  }
}

async function exportImage(panel: DiagramPanel, format: ExportFormat, scope: ExportScope): Promise<void> {
  let scale = 1;
  if (format === 'png') {
    const scaleText = await vscode.window.showQuickPick(SCALE_CHOICES, { title: 'Scale factor of the image' });
    if (scaleText === undefined) {
      return;
    }
    scale = Number(scaleText);
  }
  const data = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'classScanner: rendering the export...' },
    () => panel.requestExport(format, scope, scale),
  );
  const content = format === 'png' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
  const filters: Record<string, string[]> = format === 'png' ? { 'PNG image': ['png'] } : { 'SVG image': ['svg'] };
  await saveToFile(panel, content, `${path.basename(panel.folder)}-classes.${format}`, filters);
}

async function exportSchema(panel: DiagramPanel, scope: ExportScope): Promise<void> {
  const destination = await vscode.window.showQuickPick(['Copy to the clipboard', 'Save as a Markdown file'], {
    title: 'Schema for an LLM',
  });
  if (destination === undefined) {
    return;
  }
  const text = await panel.requestExport('schema', scope, 1);
  if (destination.startsWith('Copy')) {
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage('classScanner: schema copied to the clipboard.');
    return;
  }
  // A Markdown code block keeps the indentation when the file is shown or pasted elsewhere.
  const markdown = '```text\n' + text + '```\n';
  await saveToFile(panel, Buffer.from(markdown, 'utf8'), `${path.basename(panel.folder)}-schema.md`, { Markdown: ['md'] });
}

async function saveToFile(panel: DiagramPanel, content: Buffer, defaultName: string, filters: Record<string, string[]>): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? panel.folder;
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspaceFolder, defaultName)),
    filters,
  });
  if (target === undefined) {
    return;
  }
  await writeFile(target.fsPath, content);
  void vscode.window.showInformationMessage(`classScanner: exported to ${target.fsPath}`);
}

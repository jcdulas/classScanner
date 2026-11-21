// Integration tests, run inside a real VS Code by scripts/runIntegrationTests.mjs.
//
// They open the diagram of the fixture project, wait until the webview
// reports that the cards are on screen, and export images of the result to
// out/integration/ so that the rendering can be checked by eye.

import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import type { ClassScannerApi } from '../../src/extension/extension';
import { StateStore } from '../../src/extension/stateStore';
import { ALL_RELATION_KINDS } from '../../src/shared/graphModel';
import { createDefaultState } from '../../src/shared/savedState';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_FOLDER = path.join(PROJECT_ROOT, 'out', 'integration');

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<ClassScannerApi>('jcdulas.class-scanner');
  assert.ok(extension, 'The extension is installed');
  const api = await extension.activate();
  const webviewErrors: string[] = [];
  api.onWebviewError((message) => webviewErrors.push(message));
  await mkdir(OUTPUT_FOLDER, { recursive: true });

  await testFixtureProject(api);
  await testRescanOnSave(api);
  await testSyntheticProjectIfPresent(api);
  // Last, because it opens text editors next to the diagrams, which would change the frame times measured above.
  await testPairedFolders(api);

  assert.deepEqual(webviewErrors, [], 'The webview reported no error');
  console.log(`Integration tests passed on VS Code ${vscode.version}.`);
}

async function testFixtureProject(api: ClassScannerApi): Promise<void> {
  const folder = path.join(PROJECT_ROOT, 'test', 'fixtures', 'project');
  // A saved arrangement with every relation kind active and one card pinned to full:
  // it is loaded by the first scan, which also tests the persistence.
  const stateStore = new StateStore(folder, OUTPUT_FOLDER);
  await stateStore.write(
    { ...createDefaultState(), activeRelations: [...ALL_RELATION_KINDS], displayModes: { 'geo::Scene': 'full' } },
    -1,
  );

  const shown = waitForEvent(api.onDiagramShown, 60_000);
  await api.scanFolder(folder, -1);
  const info = await shown;
  // 12 classes, minus the forward-declared `Canvas`, hidden by default.
  assert.equal(info.visibleNodeCount, 11);

  // Showing the diagram places the camera, which is saved one second later.
  await delay(2000);
  const saved = await stateStore.read();
  assert.ok(saved?.camera !== undefined, 'The camera was saved');
  assert.ok(Object.keys(saved?.positions.grouped ?? {}).length >= 11, 'The positions were saved');
  assert.equal(saved?.displayModes['geo::Scene'], 'full');

  await savePng(api, 'view', 1, 'fixture-view.png');
  await savePng(api, 'diagram', 1, 'fixture-diagram.png');
  const svg = await api.exportActiveDiagram('svg', 'diagram', 1);
  assert.match(svg, /<svg[^>]+>/);
  assert.match(svg, /Scene/);
  await writeFile(path.join(OUTPUT_FOLDER, 'fixture-diagram.svg'), svg);

  const schema = await api.exportActiveDiagram('schema', 'diagram', 1);
  assert.match(schema, /abstract class Shape/);
  assert.match(schema, /geo::Scene o-- geo::Layer \[\*\]/);
  await writeFile(path.join(OUTPUT_FOLDER, 'fixture-schema.txt'), schema);
  // The lightest schema: no members, no file locations.
  const lightSchema = await api.exportActiveDiagram('schema', 'diagram', 1, { members: 'none', includeLocations: false });
  assert.match(lightSchema, /\n  abstract class Shape\n/);
  assert.doesNotMatch(lightSchema, /shape\.h|origin: Point/);
  assert.ok(lightSchema.length < schema.length, 'The light schema is shorter');

  // Scene is declared in include/geometry/scene.h and its methods are defined in src/scene.cpp.
  for (const [layout, expectedNames] of [
    ['tree', ['include/geometry/scene.h', 'src/scene.cpp']],
    ['flat', ['scene.h', 'scene.cpp']],
  ] as const) {
    const zipPath = path.join(OUTPUT_FOLDER, `fixture-sources-${layout}.zip`);
    const fileCount = await api.exportActiveDiagramSources(['geo::Scene'], layout, zipPath);
    assert.equal(fileCount, 2);
    assert.deepEqual(Object.keys(unzipSync(await readFile(zipPath))).sort(), [...expectedNames].sort());
  }
  console.log(`Fixture project shown, layout in ${Math.round(info.layoutDurationMs)} ms.`);
}

/** Saving a C++ file of the scanned folder scans it again and shows the diagram again (spec §2.1). */
async function testRescanOnSave(api: ClassScannerApi): Promise<void> {
  const file = vscode.Uri.file(path.join(PROJECT_ROOT, 'test', 'fixtures', 'project', 'top.hpp'));
  const document = await vscode.workspace.openTextDocument(file);
  const originalText = document.getText();
  const replaceContent = async (text: string) => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(file, new vscode.Range(0, 0, document.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
    await document.save();
  };
  const shown = waitForEvent(api.onDiagramShown, 30_000);
  try {
    await replaceContent(originalText + 'class AddedBySave {};\n');
    const info = await shown;
    // The new class is in the diagram: 11 visible classes became 12.
    assert.equal(info.visibleNodeCount, 12);
  } finally {
    const restored = waitForEvent(api.onDiagramShown, 30_000);
    await replaceContent(originalText);
    await restored;
  }
  console.log('Rescan on save: the diagram followed a saved file.');
}

/**
 * A folder under `src` is scanned together with its counterpart under `inc` (spec §2.2), and
 * the files opened from the diagram all go to one editor column (spec §4.6).
 */
async function testPairedFolders(api: ClassScannerApi): Promise<void> {
  const pairedProject = path.join(PROJECT_ROOT, 'test', 'fixtures', 'paired');
  const shown = waitForEvent(api.onDiagramShown, 60_000);
  await api.scanFolder(path.join(pairedProject, 'src', 'core'), -1);
  const info = await shown;
  // Engine and Timer are declared in inc/core: the scan of src/core alone would find no class.
  assert.equal(info.visibleNodeCount, 2);

  const zipPath = path.join(OUTPUT_FOLDER, 'paired-sources.zip');
  await api.exportActiveDiagramSources(['app::Engine'], 'tree', zipPath);
  assert.deepEqual(Object.keys(unzipSync(await readFile(zipPath))).sort(), ['inc/core/engine.h', 'src/core/engine.cpp']);

  // The first opening gives the focus to the new editor. The second one must reuse that
  // editor instead of opening the file again beside it.
  const header = path.join(pairedProject, 'inc', 'core', 'engine.h');
  await api.openActiveDiagramSource('inc/core/engine.h', 8);
  const groupCount = vscode.window.tabGroups.all.length;
  await api.openActiveDiagramSource('inc/core/engine.h', 11);
  assert.equal(countTabsShowing(header), 1, 'The header is open in one editor only');
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, 10, 'The editor moved to the requested line');
  // The source file of the class goes to the same column as its header.
  await api.openActiveDiagramSource('src/core/engine.cpp', 7);
  assert.equal(countTabsShowing(path.join(pairedProject, 'src', 'core', 'engine.cpp')), 1);
  assert.equal(vscode.window.tabGroups.all.length, groupCount, 'No editor column was added');

  // The editor column is now moved to the left of the diagram, which leaves no column on the
  // right of the diagram: files must open in that column, not in a new one.
  await vscode.commands.executeCommand('workbench.action.moveActiveEditorGroupLeft');
  // The diagram learns its new column from an event of VS Code.
  await delay(500);
  const codeColumn = columnsShowing(path.join(pairedProject, 'src', 'core', 'engine.cpp'))[0];
  await api.openActiveDiagramSource('inc/core/util.h', 1);
  assert.deepEqual(columnsShowing(path.join(pairedProject, 'inc', 'core', 'util.h')), [codeColumn], 'The file opened in the existing editor column');
  await api.openActiveDiagramSource('src/core/util.cpp', 1);
  assert.deepEqual(columnsShowing(path.join(pairedProject, 'src', 'core', 'util.cpp')), [codeColumn]);
  assert.equal(vscode.window.tabGroups.all.length, groupCount, 'No editor column was added on the right of the diagram');
  console.log('Paired folders: src/core was scanned with inc/core, and files open in a single editor column.');
}

function countTabsShowing(filePath: string): number {
  return columnsShowing(filePath).length;
}

/** The editor columns that have a tab for the file. */
function columnsShowing(filePath: string): vscode.ViewColumn[] {
  const columns: vscode.ViewColumn[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.toLowerCase() === filePath.toLowerCase()) {
        columns.push(group.viewColumn);
      }
    }
  }
  return columns;
}

async function testSyntheticProjectIfPresent(api: ClassScannerApi): Promise<void> {
  const folder = path.join(PROJECT_ROOT, 'test', 'synthetic-project');
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(folder));
  } catch {
    console.log('Synthetic project not generated: skipped (npm run generate:synthetic).');
    return;
  }
  // The worst case: every relation kind active (about 24 000 edges in the synthetic project).
  await new StateStore(folder, OUTPUT_FOLDER).write({ ...createDefaultState(), activeRelations: [...ALL_RELATION_KINDS] }, -1);
  const start = Date.now();
  const shown = waitForEvent(api.onDiagramShown, 120_000);
  await api.scanFolder(folder, -1);
  const info = await shown;
  console.log(
    `Synthetic project: ${info.visibleNodeCount} classes shown ${Date.now() - start} ms after the scan started ` +
      `(layout ${Math.round(info.layoutDurationMs)} ms).`,
  );
  assert.equal(info.visibleNodeCount, 1500);
  await savePng(api, 'view', 1, 'synthetic-view.png');

  for (const statistics of await api.measureActiveDiagramPerformance()) {
    if (statistics.level.startsWith('toggle')) {
      console.log(`Relation ${statistics.level}: ${statistics.averageFrameMs.toFixed(0)} ms until drawn (target: under 100 ms).`);
      continue;
    }
    const framesPerSecond = 1000 / statistics.averageFrameMs;
    console.log(
      `Panning at ${statistics.level} level: ${framesPerSecond.toFixed(0)} frames/s on average, ` +
        `95% of frames under ${statistics.percentile95FrameMs.toFixed(1)} ms (target: 60 frames/s).`,
    );
  }
}

async function savePng(api: ClassScannerApi, scope: 'view' | 'diagram', scale: number, fileName: string): Promise<void> {
  const base64 = await api.exportActiveDiagram('png', scope, scale);
  assert.ok(base64.length > 1000, `The ${scope} PNG is not empty`);
  await writeFile(path.join(OUTPUT_FOLDER, fileName), Buffer.from(base64, 'base64'));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForEvent<T>(event: vscode.Event<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
    const subscription = event((value) => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(value);
    });
  });
}

// Integration tests, run inside a real VS Code by scripts/runIntegrationTests.mjs.
//
// They open the diagram of the fixture project, wait until the webview
// reports that the cards are on screen, and export images of the result to
// out/integration/ so that the rendering can be checked by eye.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
  await testSyntheticProjectIfPresent(api);

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
  console.log(`Fixture project shown, layout in ${Math.round(info.layoutDurationMs)} ms.`);
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

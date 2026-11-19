// Scans a folder and writes the `graph` message the extension host would send to the webview.
// Used by scripts/previewWebview.mjs to show the webview in a browser, outside of VS Code.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInProcessParseFunction } from '../../src/scanner/inProcessParser';
import { scanFolder } from '../../src/scanner/scanFolder';
import { ALL_RELATION_KINDS, RelationKind } from '../../src/shared/graphModel';
import { HostToWebviewMessage } from '../../src/shared/messages';
import { createDefaultState } from '../../src/shared/savedState';

export async function buildPreviewData(projectRoot: string, folder: string, activeRelations: string, outputFile: string): Promise<void> {
  const nodeModules = path.join(projectRoot, 'node_modules');
  const { graph, report } = await scanFolder({
    folder,
    discovery: { maxDepth: -1, extensions: ['.cpp', '.hpp', '.h'], exclude: ['**/build/**'], maxFileSizeBytes: 2048 * 1024 },
    parseFiles: createInProcessParseFunction(
      {
        runtime: path.join(nodeModules, 'web-tree-sitter', 'web-tree-sitter.wasm'),
        cppGrammar: path.join(nodeModules, 'tree-sitter-cpp', 'tree-sitter-cpp.wasm'),
      },
      [],
    ),
  });
  const relations = activeRelations === 'all' ? ALL_RELATION_KINDS : (activeRelations.split(',') as RelationKind[]);
  const message: HostToWebviewMessage = {
    type: 'graph',
    graph,
    report,
    savedState: { ...createDefaultState(), activeRelations: relations },
    settings: { maxMembersInAutoMode: 12, structuralRelations: ['inherit', 'compose'] },
  };
  await writeFile(outputFile, JSON.stringify(message));
}

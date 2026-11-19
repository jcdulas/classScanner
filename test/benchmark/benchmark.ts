// Measures the scan duration on the synthetic project (spec §8).
//
// Run with `npm run benchmark` after `npm run generate:synthetic`. It uses
// the real worker pool and the bundled worker script from dist/, so it
// measures what the extension does.

import path from 'node:path';
import { createWorkerParseFunction } from '../../src/scanner/parserPool';
import { scanFolder } from '../../src/scanner/scanFolder';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SYNTHETIC_PROJECT = path.join(PROJECT_ROOT, 'test', 'synthetic-project');

async function main(): Promise<void> {
  const scanStart = Date.now();
  const { graph, report } = await scanFolder({
    folder: SYNTHETIC_PROJECT,
    discovery: {
      maxDepth: -1,
      extensions: ['.cpp', '.hpp', '.h'],
      exclude: [],
      maxFileSizeBytes: 2048 * 1024,
    },
    parseFiles: createWorkerParseFunction(path.join(PROJECT_ROOT, 'dist', 'parserWorker.js'), { ignoredMacros: [] }),
  });
  const scanDuration = Date.now() - scanStart;

  console.log(`Files:   ${report.scannedFileCount}`);
  console.log(`Classes: ${graph.nodes.length}`);
  console.log(`Edges:   ${graph.edges.length} ${JSON.stringify(report.edgeCounts)}`);
  console.log(`Parse errors: ${report.parseErrorCount}, unresolved references: ${report.unresolvedTypeReferenceCount}`);
  console.log(`Scan:    ${scanDuration} ms (target: under 15000 ms)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

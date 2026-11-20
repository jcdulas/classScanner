// Measures the scan duration on the synthetic project (spec §8).
//
// Run with `npm run benchmark` after `npm run generate:synthetic`. It uses
// the real worker pool and the bundled worker script from dist/, so it
// measures what the extension does. `npm run benchmark -- --latency 10` runs
// it on a simulated slow disk (slowDisk.cjs).

import path from 'node:path';
import { createWorkerParseFunction } from '../../src/scanner/parserPool';
import { scanFolder } from '../../src/scanner/scanFolder';
import { RelationKind } from '../../src/shared/graphModel';
import { ALL_LAYOUT_KINDS } from '../../src/shared/savedState';
import { computeLayout } from '../../src/webview/layout/computeLayout';
import { computeCardLayout } from '../../src/webview/model/cardGeometry';
import { groupKeyOf } from '../../src/webview/model/groups';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SYNTHETIC_PROJECT = path.join(PROJECT_ROOT, 'test', 'synthetic-project');

async function main(): Promise<void> {
  const scanStart = Date.now();
  let listingDuration = 0;
  const { graph, report } = await scanFolder({
    folder: SYNTHETIC_PROJECT,
    discovery: {
      maxDepth: -1,
      extensions: ['.cpp', '.hpp', '.h'],
      exclude: [],
    },
    parseFiles: createWorkerParseFunction(path.join(PROJECT_ROOT, 'dist', 'parserWorker.js'), {
      ignoredMacros: [],
      maxFileSizeBytes: 2048 * 1024,
    }),
    onDiscovered: () => {
      listingDuration = Date.now() - scanStart;
    },
  });
  const scanDuration = Date.now() - scanStart;

  console.log(`Files:   ${report.scannedFileCount}`);
  console.log(`Classes: ${graph.nodes.length}`);
  console.log(`Edges:   ${graph.edges.length} ${JSON.stringify(report.edgeCounts)}`);
  console.log(`Parse errors: ${report.parseErrorCount}, unresolved references: ${report.unresolvedTypeReferenceCount}`);
  console.log(`Scan:    ${scanDuration} ms, of which ${listingDuration} ms to list the files (target: under 15000 ms)`);

  // The layouts run in a web worker in the extension; the same code runs here in Node.
  const metrics = { charWidth: 7.2 };
  const nodes = graph.nodes.map((node) => {
    const card = computeCardLayout(node, 'capped', 12, metrics);
    return { id: node.id, width: card.width, height: card.height, group: groupKeyOf(node, 'namespace', graph.files) };
  });
  const structuralKinds = new Set<RelationKind>(['inherit', 'compose']);
  const edges = graph.edges.filter((edge) => structuralKinds.has(edge.kind));
  for (const kind of ALL_LAYOUT_KINDS) {
    const layoutStart = Date.now();
    await computeLayout({ kind, nodes, edges, affinityEdges: graph.edges });
    console.log(`Layout ${kind}: ${Date.now() - layoutStart} ms for ${nodes.length} cards and ${edges.length} edges (target: under 5000 ms)`);
  }
  // Worst case of the grouped layout: grouping "none" puts every card in one group.
  const singleGroupStart = Date.now();
  await computeLayout({ kind: 'grouped', nodes: nodes.map((node) => ({ ...node, group: '' })), edges, affinityEdges: graph.edges });
  console.log(`Layout grouped, no grouping: ${Date.now() - singleGroupStart} ms (target: under 5000 ms)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

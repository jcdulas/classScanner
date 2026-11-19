// Bundles and runs the benchmark in test/benchmark/benchmark.ts.
// Run `npm run build` first: the benchmark uses the bundled parser worker from dist/.

import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(projectRoot, 'out', 'benchmark.js');

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'test', 'benchmark', 'benchmark.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'warning',
});

createRequire(import.meta.url)(outputFile);

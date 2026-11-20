// Bundles and runs the benchmark in test/benchmark/benchmark.ts.
// Run `npm run build` first: the benchmark uses the bundled parser worker from dist/.
//
// Usage: node scripts/benchmark.mjs [--latency 10]
//
// --latency imitates a slow disk such as a network drive: every file system call on the
// synthetic project waits that many milliseconds (see test/benchmark/slowDisk.cjs).

import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(projectRoot, 'out', 'benchmark.js');

const latencyIndex = process.argv.indexOf('--latency');
const latencyMs = latencyIndex === -1 ? 0 : Number(process.argv[latencyIndex + 1]);

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'test', 'benchmark', 'benchmark.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'warning',
});

if (latencyMs > 0) {
  // The slow disk is a preload: it has to be given to a new Node process, which also passes it to its worker threads.
  console.log(`Simulated disk latency: ${latencyMs} ms per file system call`);
  const result = spawnSync(process.execPath, ['--require', path.join(projectRoot, 'test', 'benchmark', 'slowDisk.cjs'), outputFile], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SLOW_DISK_LATENCY_MS: String(latencyMs),
      SLOW_DISK_FOLDER: path.join(projectRoot, 'test', 'synthetic-project'),
    },
  });
  process.exit(result.status ?? 1);
} else {
  createRequire(import.meta.url)(outputFile);
}

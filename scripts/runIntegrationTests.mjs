// Runs the integration tests in a real VS Code, by default version 1.130.0,
// the oldest version the extension supports (see docs/SPEC.md, Compatibility).
//
// Usage: node scripts/runIntegrationTests.mjs [--vscode-version 1.130.0|stable]
// Run `npm run build` first (npm run test:integration does both).

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionIndex = process.argv.indexOf('--vscode-version');
const version = versionIndex === -1 ? '1.130.0' : process.argv[versionIndex + 1];
const testsBundle = path.join(projectRoot, 'out', 'integration', 'index.js');

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'test', 'integration', 'index.ts')],
  outfile: testsBundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  logLevel: 'warning',
});

const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
if (process.platform === 'win32') {
  await useSeparateUpdateMutex(path.dirname(vscodeExecutablePath));
}

// When this script is started from a terminal inside VS Code, this variable is inherited and
// would make the test VS Code start as a plain Node process instead of an editor.
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: testsBundle,
    // The `test` folder is the workspace: the fixture and synthetic projects are both inside it,
    // so their saved arrangements go to test/.classscanner.
    launchArgs: [path.join(projectRoot, 'test'), '--disable-extensions', '--disable-workspace-trust'],
  });
} catch (error) {
  console.error('Integration tests failed:', error);
  process.exit(1);
}

/**
 * On Windows, VS Code refuses to start while the installed VS Code holds its "updating"
 * mutex (an update is waiting to be installed). The test copy, downloaded in .vscode-test,
 * is given its own mutex name so that it does not depend on the state of the installed VS Code.
 */
async function useSeparateUpdateMutex(installFolder) {
  for (const entry of await readdir(installFolder, { withFileTypes: true })) {
    const productPath = path.join(installFolder, entry.name, 'resources', 'app', 'product.json');
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      const product = JSON.parse(await readFile(productPath, 'utf8'));
      if (product.win32MutexName !== 'vscode-integration-tests') {
        product.win32MutexName = 'vscode-integration-tests';
        await writeFile(productPath, JSON.stringify(product, null, '\t'));
      }
    } catch {
      // Not the folder that contains product.json.
    }
  }
}

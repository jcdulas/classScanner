// Builds the extension with esbuild.
//
// Four bundles are produced in dist/:
//   extension.js            the extension host code (Node, CommonJS)
//   parserWorker.js         the worker thread that parses C++ files (Node, CommonJS)
//   webview/main.js         the diagram user interface (browser, IIFE) and main.css
//   webview/layoutWorker.js the web worker that computes layouts (browser, IIFE)
// The two WebAssembly files needed by tree-sitter are copied next to the parser worker.
//
// Usage: node scripts/build.mjs [--watch] [--production]

import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWatchMode = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

const commonOptions = {
  bundle: true,
  minify: isProduction,
  sourcemap: isProduction ? false : 'linked',
  logLevel: 'info',
  absWorkingDir: projectRoot,
};

const nodeBundles = {
  ...commonOptions,
  entryPoints: {
    extension: 'src/extension/extension.ts',
    parserWorker: 'src/parser/parserWorker.ts',
  },
  outdir: 'dist',
  platform: 'node',
  format: 'cjs',
  // VS Code 1.130.0 runs extensions on Node 22; Node 20 keeps a safety margin.
  target: 'node20',
  external: ['vscode'],
  // web-tree-sitter is an ES module that reads `import.meta.url`, which does not exist in
  // CommonJS output. It is replaced with the URL of the bundle file itself.
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
};

const webviewBundles = {
  ...commonOptions,
  entryPoints: {
    main: 'src/webview/main.tsx',
    layoutWorker: 'src/webview/layout/layoutWorker.ts',
  },
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'iife',
  // The webview of VS Code 1.130.0 is a recent Chromium.
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
};

async function copyWasmFiles() {
  await mkdir(path.join(projectRoot, 'dist'), { recursive: true });
  const wasmFiles = [
    'node_modules/web-tree-sitter/web-tree-sitter.wasm',
    'node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm',
  ];
  for (const wasmFile of wasmFiles) {
    const source = path.join(projectRoot, wasmFile);
    const destination = path.join(projectRoot, 'dist', path.basename(wasmFile));
    await copyFile(source, destination);
  }
}

async function main() {
  await copyWasmFiles();
  if (isWatchMode) {
    const nodeContext = await esbuild.context(nodeBundles);
    const webviewContext = await esbuild.context(webviewBundles);
    await Promise.all([nodeContext.watch(), webviewContext.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([esbuild.build(nodeBundles), esbuild.build(webviewBundles)]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Renders the webview in a headless browser and saves a screenshot, to check the user
// interface without starting VS Code. Run `npm run build` first.
//
// Usage: node scripts/previewWebview.mjs [--theme dark|light]
//        [--scenario default|selection|zoom|menu|menuAt|zoomAt|click|hover|doubleClick|drag|multiDrag|ctrlClickTwice|schemaPanel|interfacePanel|search|toggleRow]
//        [--x 0.5 --y 0.5] [--undo 1] [--text area] [--alt 1] [--shift 1] [--count 2]
//        [--folder test/fixtures/project] [--relations all|inherit,compose] [--size 1500x950] [--pixel-ratio 2]
//        [--output out/preview/preview.png] [--state '{"simplifyCardsWhenZoomedOut":false}']
//
// --state gives fields of the saved arrangement (src/shared/savedState.ts) as JSON.
// --pixel-ratio simulates a screen with that many device pixels per CSS pixel, to check that text is sharp on it.
//
// The page is test/preview/harness.html: it stands in for VS Code (theme variables and
// acquireVsCodeApi) and can play a scenario of mouse actions before the screenshot.
// The files that the scenario asked the editor to open are printed.

import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewFolder = path.join(projectRoot, 'out', 'preview');

function option(name, defaultValue) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? defaultValue : process.argv[index + 1];
}

const theme = option('theme', 'dark');
const scenario = option('scenario', 'default');
const folder = path.resolve(projectRoot, option('folder', 'test/fixtures/project'));
const relations = option('relations', 'inherit,compose,aggregate');
const [width, height] = option('size', '1500x950').split('x');
const pixelRatio = option('pixel-ratio', '1');
const output = path.resolve(projectRoot, option('output', `out/preview/${scenario}-${theme}.png`));

const BROWSER_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };

async function buildGraphMessage() {
  const bundle = path.join(previewFolder, 'buildPreviewData.js');
  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'test', 'preview', 'buildPreviewData.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'warning',
    // Same replacement as in scripts/build.mjs, for web-tree-sitter.
    define: { 'import.meta.url': 'importMetaUrl' },
    banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  });
  const { buildPreviewData } = createRequire(import.meta.url)(bundle);
  const extraState = JSON.parse(option('state', '{}'));
  await buildPreviewData(projectRoot, folder, relations, extraState, path.join(previewFolder, 'graph.json'));
}

/** Serves the harness page, the graph and the webview bundles of dist/. */
function startServer() {
  const server = http.createServer(async (request, response) => {
    const urlPath = new URL(request.url, 'http://localhost').pathname;
    let filePath;
    if (urlPath === '/') {
      filePath = path.join(projectRoot, 'test', 'preview', 'harness.html');
    } else if (urlPath === '/graph.json') {
      filePath = path.join(previewFolder, 'graph.json');
    } else if (urlPath.startsWith('/webview/')) {
      filePath = path.join(projectRoot, 'dist', 'webview', path.basename(urlPath));
    }
    try {
      const content = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Opens the page in a headless browser, waits until the page sets its title to `preview-ready`
 * (the diagram is shown and the scenario was played), then saves a screenshot. The browser is
 * driven through the Chrome DevTools Protocol, a JSON protocol over a WebSocket.
 */
async function takeScreenshot(url) {
  const browserPath = BROWSER_PATHS.find((candidate) => existsSync(candidate));
  if (browserPath === undefined) {
    throw new Error('No Chrome or Edge browser was found.');
  }
  const debuggingPort = 9300 + Math.floor(Math.random() * 500);
  const browser = spawn(browserPath, [
    '--headless=new',
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${pixelRatio}`,
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${path.join(previewFolder, 'browser-profile')}`,
    url,
  ]);
  try {
    const socket = await connectToPage(debuggingPort);
    const send = createCommandSender(socket);
    const deadline = Date.now() + 60000;
    for (;;) {
      const title = (await send('Runtime.evaluate', { expression: 'document.title' })).result.value;
      if (title === 'preview-ready') {
        break;
      }
      if (String(title).startsWith('preview-error') || Date.now() > deadline) {
        throw new Error(`The preview did not become ready (page title: ${title})`);
      }
      await delay(200);
    }
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(output, Buffer.from(screenshot.data, 'base64'));
    const opened = (await send('Runtime.evaluate', { expression: 'window.previewOpenedSources.join(", ")' })).result.value;
    console.log(opened === '' ? 'The scenario opened no file in the editor.' : `Files the scenario opened in the editor: ${opened}`);
    socket.close();
  } finally {
    browser.kill();
  }
}

/** Waits for the browser to start, then opens the debugging WebSocket of its page. */
async function connectToPage(debuggingPort) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debuggingPort}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page !== undefined) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve);
          socket.addEventListener('error', reject);
        });
        return socket;
      }
    } catch {
      // The browser is not listening yet.
    }
    await delay(200);
  }
  throw new Error('Could not connect to the headless browser.');
}

/** Returns a function that sends one protocol command and resolves with its result. */
function createCommandSender(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });
  return (method, parameters = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params: parameters }));
    });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await mkdir(previewFolder, { recursive: true });
await buildGraphMessage();
const server = await startServer();
try {
  const address = server.address();
  // The parameters read by the scenarios of the harness page.
  const query = new URLSearchParams({
    theme,
    scenario,
    x: option('x', '0.5'),
    y: option('y', '0.5'),
    undo: option('undo', '0'),
    text: option('text', ''),
    alt: option('alt', '0'),
    shift: option('shift', '0'),
    count: option('count', '1'),
  });
  await takeScreenshot(`http://127.0.0.1:${address.port}/?${query}`);
  console.log(`Screenshot saved to ${output}`);
} finally {
  server.close();
}

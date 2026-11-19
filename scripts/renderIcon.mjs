// Renders assets/icon.svg to assets/icon.png (256 x 256, transparent corners).
// VS Code only accepts PNG for the icon of an extension. The SVG is rendered by a
// headless Chrome or Edge, which draws gradients and shadows faithfully.
//
// Usage: node scripts/renderIcon.mjs

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(projectRoot, 'assets', 'icon.svg');
const output = path.join(projectRoot, 'assets', 'icon.png');

const BROWSER_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const browser = BROWSER_PATHS.find((candidate) => existsSync(candidate));
if (browser === undefined) {
  throw new Error('No Chrome or Edge browser was found.');
}
execFileSync(browser, [
  '--headless=new',
  '--hide-scrollbars',
  '--window-size=256,256',
  // A fully transparent page background, so that the corners of the icon stay transparent.
  '--default-background-color=00000000',
  `--screenshot=${output}`,
  pathToFileURL(source).href,
]);
console.log(`Icon rendered to ${output}`);
